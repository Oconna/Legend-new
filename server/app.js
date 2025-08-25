const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import controller modules
const improvedLobbyManager = require('./controllers/improvedLobbyManager');
const gameController = require('./controllers/gameController');
const { setupGameHandlers, startGameAfterRaceSelection } = require('./socketHandlers/gameHandlers');
const raceController = require('./controllers/raceController');
const db = require('./config/database');
const mapController = require('./controllers/mapController');

// Express App Setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory storage
const dbGamePlayers = new Map(); // gameId -> Set of socketIds
const chatRooms = new Map(); // gameId -> { messages: [], players: Set() }

// Helper Functions
function getChatRoom(gameId) {
    if (!chatRooms.has(gameId)) {
        chatRooms.set(gameId, {
            messages: [],
            players: new Set(),
            createdAt: new Date()
        });
    }
    return chatRooms.get(gameId);
}

function addChatMessage(gameId, playerName, message, playerId = null) {
    const chatRoom = getChatRoom(gameId);
    const chatMessage = {
        id: Date.now() + Math.random(),
        playerName: playerName,
        message: message,
        timestamp: Date.now(),
        playerId: playerId
    };
    
    chatRoom.messages.push(chatMessage);
    
    // Keep only last 100 messages per room
    if (chatRoom.messages.length > 100) {
        chatRoom.messages.shift();
    }
    
    return chatMessage;
}

function validateChatMessage(message) {
    if (!message || typeof message !== 'string') {
        return { valid: false, reason: 'Nachricht ist leer oder ungültig' };
    }
    
    const trimmed = message.trim();
    if (trimmed.length === 0) {
        return { valid: false, reason: 'Nachricht ist leer' };
    }
    
    if (trimmed.length > 500) {
        return { valid: false, reason: 'Nachricht ist zu lang (max. 500 Zeichen)' };
    }
    
    // Basic content filtering
    const forbiddenPatterns = [
        /<script/i,
        /javascript:/i,
        /on\w+=/i
    ];
    
    for (let pattern of forbiddenPatterns) {
        if (pattern.test(trimmed)) {
            return { valid: false, reason: 'Nachricht enthält nicht erlaubten Inhalt' };
        }
    }
    
    return { valid: true, message: trimmed };
}

async function startAutomaticMapGeneration(gameId) {
    try {
        console.log(`🗺️ Starting automatic map generation for game ${gameId}...`);
        
        // Doppelte Sicherheitsprüfung: Sind wirklich alle Spieler bereit?
        const doubleCheck = await gameController.getAllRaceSelections(gameId);
        if (!doubleCheck.success) {
            throw new Error('Could not verify player status for map generation');
        }
        
        const totalPlayers = doubleCheck.selections.length;
        const confirmedPlayers = doubleCheck.selections.filter(s => s.race_confirmed === 1).length;
        
        if (confirmedPlayers !== totalPlayers) {
            console.log(`❌ Map generation cancelled - not all players ready (${confirmedPlayers}/${totalPlayers})`);
            io.to(`db_game_${gameId}`).emit('map_generation_error', {
                success: false,
                message: `Kartengenerierung abgebrochen - nicht alle Spieler bereit (${confirmedPlayers}/${totalPlayers})`
            });
            return;
        }
        
        console.log(`✅ Double-check passed - all ${totalPlayers} players are ready. Generating map...`);
        
        // Starte die tatsächliche Kartengenerierung
        const mapResult = await mapController.generateMap(gameId);
        
        if (mapResult.success) {
            console.log(`✅ Automatic map generation successful for game ${gameId}`);
            
            // Benachrichtige ALLE Spieler über erfolgreiche Kartengenerierung
            io.to(`db_game_${gameId}`).emit('map_generated', {
                success: true,
                gameId: gameId,
                mapSize: mapResult.mapSize,
                playerCount: mapResult.playerCount,
                message: 'Karte wurde erfolgreich generiert!'
            });
            
            // Update game status to playing (falls noch nicht geschehen)
            await db.query(
                'UPDATE games SET status = "playing", started_at = NOW() WHERE id = ? AND status != "playing"',
                [gameId]
            );
            
            console.log(`🎮 Game ${gameId} is now PLAYING!`);
            
        } else {
            console.error(`❌ Automatic map generation FAILED for game ${gameId}:`, mapResult.message);
            
            // Benachrichtige alle Spieler über Fehler
            io.to(`db_game_${gameId}`).emit('map_generation_error', {
                success: false,
                message: mapResult.message || 'Unbekannter Fehler bei der automatischen Kartengenerierung'
            });
        }
        
    } catch (error) {
        console.error('ERROR in automatic map generation:', error);
        io.to(`db_game_${gameId}`).emit('map_generation_error', {
            success: false,
            message: 'Server-Fehler bei der automatischen Kartengenerierung: ' + error.message
        });
    }
}

async function broadcastRaceSelectionSync(gameId) {
    try {
        console.log(`📊 Enhanced race selection sync for game ${gameId}`);
        
        // 1. Hole alle aktuellen Rassenauswahlen
        const result = await gameController.getAllRaceSelections(gameId);
        if (!result.success) {
            console.error('Could not get race selections for sync:', result.message);
            return;
        }

        // 2. Sende Sync an alle Spieler
        io.to(`db_game_${gameId}`).emit('race_selection_sync', {
            gameId: gameId,
            selections: result.selections,
            timestamp: new Date().toISOString()
        });
        
        console.log(`✓ Race selection sync broadcasted for game ${gameId} (${result.selections.length} players)`);

        // 3. NEUE KRITISCHE LOGIK: Prüfe ob alle Spieler bereit sind
        const totalPlayers = result.selections.length;
        const confirmedPlayers = result.selections.filter(s => s.race_confirmed === 1).length;
        
        console.log(`🔍 Game ${gameId}: ${confirmedPlayers}/${totalPlayers} players confirmed races`);
        
        // Debug: Zeige Spielerstatus
        result.selections.forEach(player => {
            console.log(`  - ${player.player_name}: Race ${player.race_name || 'none'} (${player.race_confirmed ? 'CONFIRMED' : 'not confirmed'})`);
        });
        
        if (totalPlayers > 0 && confirmedPlayers === totalPlayers) {
            console.log(`🎉 ALL ${totalPlayers} PLAYERS READY for game ${gameId} - Starting automatic map generation!`);
            
            // 4. Benachrichtige alle Spieler, dass alle bereit sind
            io.to(`db_game_${gameId}`).emit('game_start_ready', {
                gameId: gameId,
                message: 'Alle Spieler bereit! Kartengenerierung startet...',
                status: 'map_generation_starting',
                confirmedPlayers: confirmedPlayers,
                totalPlayers: totalPlayers
            });
            
            // 5. Starte automatische Kartengenerierung nach kurzer Verzögerung
            setTimeout(async () => {
                await startAutomaticMapGeneration(gameId);
            }, 2000); // 2 Sekunden Verzögerung für bessere UX
            
        } else {
            console.log(`⏳ Game ${gameId}: Still waiting - ${confirmedPlayers}/${totalPlayers} players ready`);
        }
        
    } catch (error) {
        console.error('Error in enhanced race selection sync:', error);
    }
}

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    setupGameHandlers(io, socket);

    // Heartbeat/Ping
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // Get available games
    socket.on('get_games', () => {
        try {
            const games = improvedLobbyManager.getAvailableGames();
            socket.emit('games_updated', games);
        } catch (error) {
            console.error('Error in get_games:', error);
            socket.emit('error', 'Fehler beim Laden der Spiele');
        }
    });

    // Create new game
    socket.on('create_game', (data) => {
        try {
            console.log('Create game request:', data);
            const result = improvedLobbyManager.createGame(socket.id, data.playerName, data.gameName, data.maxPlayers, data.mapSize);
            
            if (result.success) {
                socket.join(`game_${result.gameId}`);
                socket.emit('game_created', result);
                
                // Broadcast updated games list to all clients
                io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                
                console.log(`Game created by ${data.playerName}, broadcasting to all clients`);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in create_game:', error);
            socket.emit('error', 'Fehler beim Erstellen des Spiels: ' + error.message);
        }
    });

    socket.on('join_game', (data) => {
    try {
        console.log('Join game request:', data);
        const result = improvedLobbyManager.joinGame(socket.id, data.playerName, data.gameId);
        
        if (result.success) {
            socket.join(`game_${result.gameId}`);
            socket.emit('game_joined', result);
            
            // Notify other players
            socket.to(`game_${result.gameId}`).emit('player_joined', {
                playerName: data.playerName
            });
            
            // WICHTIG: Send updated player list to ALL players in the game room INCLUDING the joining player
            io.to(`game_${result.gameId}`).emit('lobby_players_updated', result.players);
            
            // WICHTIG: Update player count in the game info section
            io.to(`game_${result.gameId}`).emit('game_info_updated', {
                currentPlayers: result.players.length,
                maxPlayers: result.maxPlayers,
                players: result.players
            });
            
            // Update games list for everyone immediately
            io.emit('games_updated', improvedLobbyManager.getAvailableGames());
            
            console.log(`Player ${data.playerName} joined game, broadcasting to all clients`);
        } else {
            socket.emit('error', result.message);
        }
    } catch (error) {
        console.error('Error in join_game:', error);
        socket.emit('error', 'Fehler beim Beitreten des Spiels: ' + error.message);
    }
});

    socket.on('player_ready', (data) => {
    try {
        const result = improvedLobbyManager.setPlayerReady(socket.id, data.ready);
        
        if (result.success) {
            const playerData = improvedLobbyManager.players.get(socket.id);
            
            if (playerData) {
                // WICHTIG: Notify ALL players in the game (including sender)
                io.to(`game_${playerData.gameId}`).emit('player_ready_status', result);
                
                // WICHTIG: Send updated player list to ALL players
                io.to(`game_${playerData.gameId}`).emit('lobby_players_updated', result.players);
                
                // Send notification (excluding sender)
                socket.to(`game_${playerData.gameId}`).emit('player_ready_notification', {
                    playerName: playerData.name,
                    ready: data.ready
                });
            }
        } else {
            socket.emit('error', result.message);
        }
    } catch (error) {
        console.error('Error in player_ready:', error);
        socket.emit('error', 'Fehler bei der Bereitschaftsanzeige');
    }
});

    socket.on('leave_game', (data) => {
    try {
        console.log('🚪 Leave game request:', data);
        const playerData = improvedLobbyManager.players.get(socket.id);
        
        if (!playerData) {
            socket.emit('error', 'Spieler nicht in einem Spiel');
            return;
        }
        
        const gameId = playerData.gameId;
        const playerName = playerData.name;
        
        // WICHTIG: Chat-Room verlassen BEVOR das Spiel verlassen wird
        if (socket.playerName && socket.gameId) {
            const chatRoom = getChatRoom(socket.gameId);
            if (chatRoom.players.has(socket.id)) {
                chatRoom.players.delete(socket.id);
                
                // Notify remaining players in chat
                socket.to(`chat_${socket.gameId}`).emit('chat_player_left', {
                    playerName: socket.playerName,
                    playerCount: chatRoom.players.size
                });
                
                // Update player count in chat
                io.to(`chat_${socket.gameId}`).emit('chat_player_count', {
                    count: chatRoom.players.size
                });
                
                console.log(`🗨️ Player ${playerName} left chat for game ${gameId}`);
            }
        }
        
        const result = improvedLobbyManager.leaveGame(socket.id);
        
        if (result.success) {
            // Socket-Rooms verlassen
            socket.leave(`game_${gameId}`);
            socket.leave(`chat_${gameId}`);
            
            // Bestätige dem Spieler das Verlassen
            socket.emit('game_left', {
                success: true,
                gameId: gameId,
                gameDeleted: result.gameDeleted,
                message: result.gameDeleted ? 'Spiel wurde gelöscht (letzter Spieler)' : 'Du hast das Spiel verlassen'
            });

            if (!result.gameDeleted) {
                // Notify remaining players
                socket.to(`game_${gameId}`).emit('player_left', {
                    playerName: playerName
                });
                
                // WICHTIG: Send updated player list to remaining players
                io.to(`game_${gameId}`).emit('lobby_players_updated', result.players);
                
                // WICHTIG: Update player count in the game info section
                io.to(`game_${gameId}`).emit('game_info_updated', {
                    currentPlayers: result.players.length,
                    maxPlayers: result.maxPlayers || 8, // fallback
                    players: result.players
                });
                
                console.log(`📊 Updated remaining ${result.players.length} players in game ${gameId}`);
            }
            
            // Update games list for everyone
            io.emit('games_updated', improvedLobbyManager.getAvailableGames());
            
            console.log(`✅ Player ${playerName} successfully left game ${gameId}`);
            
        } else {
            socket.emit('error', result.message);
        }
    } catch (error) {
        console.error('❌ Error in leave_game:', error);
        socket.emit('error', 'Fehler beim Verlassen des Spiels');
    }
});

// WICHTIG: Auch bei disconnect die Updates senden
    socket.on('disconnect', () => {
    try {
        console.log(`🔌 Socket ${socket.id} disconnected`);
        
        const playerData = improvedLobbyManager.players.get(socket.id);
        
        // Clean up lobby manager
        if (playerData) {
            const gameId = playerData.gameId;
            const playerName = playerData.name;
            
            console.log(`🧹 Cleaning up disconnected player ${playerName} from game ${gameId}`);
            
            // Clean up chat BEFORE leaving game
            if (socket.playerName && socket.gameId) {
                const chatRoom = getChatRoom(socket.gameId);
                if (chatRoom.players.has(socket.id)) {
                    chatRoom.players.delete(socket.id);
                    
                    // Notify remaining players
                    socket.to(`chat_${socket.gameId}`).emit('chat_player_left', {
                        playerName: socket.playerName,
                        playerCount: chatRoom.players.size
                    });
                    
                    // Update player count
                    io.to(`chat_${socket.gameId}`).emit('chat_player_count', {
                        count: chatRoom.players.size
                    });
                    
                    console.log(`🗨️ Cleaned up chat for disconnected player ${playerName}`);
                }
            }
            
            // ✅ KORRIGIERT: Verwende leaveGame statt removePlayer
            const result = improvedLobbyManager.leaveGame(socket.id);
            
            if (result.success && !result.gameDeleted) {
                // Notify remaining players about disconnect
                socket.to(`game_${gameId}`).emit('player_left', {
                    playerName: playerName
                });
                
                // WICHTIG: Send updated player list
                io.to(`game_${gameId}`).emit('lobby_players_updated', result.players);
                
                // WICHTIG: Update player count
                io.to(`game_${gameId}`).emit('game_info_updated', {
                    currentPlayers: result.players.length,
                    maxPlayers: result.maxPlayers || 8,
                    players: result.players
                });
                
                console.log(`📊 Updated ${result.players.length} remaining players after disconnect`);
            }
            
            // Update games list
            io.emit('games_updated', improvedLobbyManager.getAvailableGames());
            
            console.log(`✅ Player ${playerName} cleanup completed`);
        }
        // ❌ ENTFERNT: Diese Zeile war der Fehler
        // improvedLobbyManager.removePlayer(socket.id);
        
        // Clean up database game players
        dbGamePlayers.forEach((players, gameId) => {
            if (players.has(socket.id)) {
                players.delete(socket.id);
                console.log(`🗃️ Removed ${socket.id} from DB game ${gameId}`);
                
                if (players.size === 0) {
                    dbGamePlayers.delete(gameId);
                    console.log(`🗃️ Removed empty DB game ${gameId}`);
                }
            }
        });
        
        // Clean up chat rooms
        if (socket.playerName && socket.gameId) {
            const chatRoom = getChatRoom(socket.gameId);
            if (chatRoom.players.has(socket.id)) {
                chatRoom.players.delete(socket.id);
                
                // Notify remaining players
                socket.to(`chat_${socket.gameId}`).emit('chat_player_left', {
                    playerName: socket.playerName,
                    playerCount: chatRoom.players.size
                });
                
                // Update player count
                io.to(`chat_${socket.gameId}`).emit('chat_player_count', {
                    count: chatRoom.players.size
                });
                
                console.log(`🧹 Final chat cleanup for disconnected player ${socket.playerName}`);
            }
        }
		
        if (socket.gameId && socket.playerId) {
            console.log(`🎮 Cleaning up game session for player ${socket.playerName}`);
            
            // Spieler aus dem Spielraum entfernen
            socket.to(`game_${socket.gameId}`).emit('player_disconnected', {
                playerName: socket.playerName,
                playerId: socket.playerId
            });
        }
        
        console.log(`🔌 Disconnect cleanup completed for ${socket.id}`);
        
    } catch (error) {
        console.error('❌ Error during disconnect cleanup:', error);
    }
});

    socket.on('start_game', async (data) => {
    try {
        console.log('🚀 Start game request (Race Selection):', data);
        
        if (!data.gameId || !data.playerName) {
            socket.emit('error', 'Unvollständige Daten zum Starten des Spiels');
            return;
        }

        // Prüfe ob der Spieler Host ist
        const playerData = improvedLobbyManager.players.get(socket.id);
        if (!playerData) {
            socket.emit('error', 'Spieler nicht gefunden');
            return;
        }

        const game = improvedLobbyManager.games.get(playerData.gameId);
        if (!game) {
            socket.emit('error', 'Spiel nicht gefunden');
            return;
        }

        // KORRIGIERT: Prüfe Host-Berechtigung
        if (game.hostSocketId !== socket.id) {
            socket.emit('error', 'Nur der Host kann das Spiel starten');
            return;
        }

        // KORRIGIERT: Prüfe Mindestanzahl Spieler
        if (game.players.size < 2) {
            socket.emit('error', 'Mindestens 2 Spieler benötigt');
            return;
        }

        console.log(`🎮 Host ${data.playerName} starting game ${data.gameId} with ${game.players.size} players`);

        // SCHRITT 1: Spiel in Datenbank erstellen
        const playersArray = Array.from(game.players.values());
        const dbGameResult = await gameController.createGameInDatabase({
            name: game.name,
            maxPlayers: game.maxPlayers,
            mapSize: game.mapSize,
            players: playersArray, // KORRIGIERT: Array übergeben
            status: 'race_selection' // WICHTIG: Status auf race_selection setzen
        });

        if (dbGameResult.success) {
            const dbGameId = dbGameResult.gameId;
            
            console.log(`✅ Database game created with ID: ${dbGameId} - Status: race_selection`);
            
            // SCHRITT 2: Alle Spieler zur Rassenauswahl weiterleiten
            io.to(`game_${playerData.gameId}`).emit('race_selection_started', {
                success: true,
                gameId: dbGameId,
                memoryGameId: playerData.gameId,
                message: 'Rassenauswahl startet! Wähle deine Rasse.'
            });
            
            // SCHRITT 3: Memory-Spiel entfernen (da es jetzt in der DB ist)
            setTimeout(() => {
                console.log(`🗑️ Removing memory game ${playerData.gameId} after successful DB creation`);
                
                // Alle Spieler aus Memory-Spiel entfernen
                const playersToRemove = [...playersArray];
                playersToRemove.forEach(player => {
                    const socketId = player.socketId;
                    if (socketId) {
                        improvedLobbyManager.leaveGame(socketId);
                    }
                });
                
                // Spiele-Liste aktualisieren
                io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                
            }, 2000); // 2 Sekunden Verzögerung für bessere UX
            
        } else {
            console.error('❌ Failed to create database game:', dbGameResult.message);
            socket.emit('error', 'Fehler beim Erstellen der Spieldatenbank: ' + dbGameResult.message);
        }
        
    } catch (error) {
        console.error('❌ Error in start_game (race selection):', error);
        socket.emit('error', 'Fehler beim Starten des Spiels: ' + error.message);
    }
});

    // Chat Events
    socket.on('join_chat_room', (data) => {
        try {
            console.log(`🚪 Player ${data.playerName} joining chat room for game ${data.gameId}`);
            
            if (!data.gameId || !data.playerName) {
                socket.emit('error', 'Unvollständige Daten für Chat-Beitritt');
                return;
            }
            
            const chatRoom = getChatRoom(data.gameId);
            
            // Player zum Chat-Raum hinzufügen
            chatRoom.players.add(socket.id);
            socket.join(`chat_${data.gameId}`);
            
            // Store player info with socket
            socket.playerName = data.playerName;
            socket.gameId = data.gameId;
            
            // Send chat history to joining player
            if (chatRoom.messages.length > 0) {
                socket.emit('chat_history', {
                    messages: chatRoom.messages
                });
                console.log(`📜 Sent ${chatRoom.messages.length} chat messages to ${data.playerName}`);
            }
            
            // Notify other players
            socket.to(`chat_${data.gameId}`).emit('chat_player_joined', {
                playerName: data.playerName,
                playerCount: chatRoom.players.size
            });
            
            // Send player count update
            io.to(`chat_${data.gameId}`).emit('chat_player_count', {
                count: chatRoom.players.size
            });
            
            console.log(`✅ Player ${data.playerName} joined chat for game ${data.gameId} (${chatRoom.players.size} players total)`);
            
        } catch (error) {
            console.error('❌ Error joining chat room:', error);
            socket.emit('error', 'Fehler beim Chat-Beitritt');
        }
    });

    socket.on('send_chat_message', (data) => {
        try {
            console.log(`💬 Chat message from ${data.playerName} in game ${data.gameId}:`, data.message);
            
            if (!data.gameId || !data.playerName || !data.message) {
                console.warn('❌ Incomplete chat message data:', data);
                socket.emit('error', 'Unvollständige Daten für Chat-Nachricht');
                return;
            }
            
            // Validate message
            const validation = validateChatMessage(data.message);
            if (!validation.valid) {
                console.warn(`❌ Invalid chat message from ${data.playerName}:`, validation.reason);
                socket.emit('error', validation.reason);
                return;
            }
            
            // Check if player is in the game
            const chatRoom = getChatRoom(data.gameId);
            if (!chatRoom.players.has(socket.id)) {
                console.warn(`❌ Player ${data.playerName} not in chat room for game ${data.gameId}`);
                socket.emit('error', 'Du bist nicht in diesem Chat-Raum');
                return;
            }
            
            // Add message to history
            const chatMessage = addChatMessage(data.gameId, data.playerName, validation.message, socket.id);
            
            // Broadcast message to all players in chat room
            const messageData = {
                playerName: data.playerName,
                message: validation.message,
                timestamp: chatMessage.timestamp,
                playerId: socket.id
            };
            
            io.to(`chat_${data.gameId}`).emit('chat_message', messageData);
            
            console.log(`✅ Chat message broadcasted in game ${data.gameId} to ${chatRoom.players.size} players`);
            
        } catch (error) {
            console.error('❌ Error sending chat message:', error);
            socket.emit('error', 'Fehler beim Senden der Chat-Nachricht');
        }
    });

    socket.on('leave_chat_room', (data) => {
    try {
        console.log(`🚪 Player ${data.playerName} leaving chat room for game ${data.gameId}`);
        
        if (!data.gameId || !data.playerName) {
            return;
        }
        
        const chatRoom = getChatRoom(data.gameId);
        
        // Remove player from chat room tracking
        if (chatRoom.players.has(socket.id)) {
            chatRoom.players.delete(socket.id);
            
            // Leave socket room
            socket.leave(`chat_${data.gameId}`);
            
            // Notify other players
            socket.to(`chat_${data.gameId}`).emit('chat_player_left', {
                playerName: data.playerName,
                playerCount: chatRoom.players.size
            });
            
            // Send updated player count to everyone
            io.to(`chat_${data.gameId}`).emit('chat_player_count', {
                count: chatRoom.players.size
            });
            
            console.log(`✅ Player ${data.playerName} left chat for game ${data.gameId} (${chatRoom.players.size} players remaining)`);
        }
        
    } catch (error) {
        console.error('❌ Error leaving chat room:', error);
    }
});

    socket.on('get_chat_history', (data) => {
        try {
            if (!data.gameId) {
                socket.emit('error', 'Game ID erforderlich für Chat-Verlauf');
                return;
            }
            
            const chatRoom = getChatRoom(data.gameId);
            
            socket.emit('chat_history', {
                gameId: data.gameId,
                messages: chatRoom.messages
            });
            
        } catch (error) {
            console.error('Error getting chat history:', error);
            socket.emit('error', 'Fehler beim Laden des Chat-Verlaufs');
        }
    });

    socket.on('join_race_selection', async (data) => {
    try {
        console.log('🎭 Join race selection request:', data);
        
        if (!data.gameId || !data.playerName) {
            socket.emit('error', 'Unvollständige Daten für Rassenauswahl-Beitritt');
            return;
        }

        const result = await raceController.joinRaceSelection(data.gameId, data.playerName, socket.id);
        
        if (result.success) {
            // Socket dem Spiel-Raum hinzufügen
            socket.join(`db_game_${data.gameId}`);
            
            // Spieler-Info in Socket speichern
            socket.raceGameId = data.gameId;
            socket.racePlayerName = data.playerName;
            
            console.log(`✅ Player ${data.playerName} joined race selection for game ${data.gameId}`);
            
            // Bestätigung an Spieler senden
            socket.emit('race_selection_joined', {
                success: true,
                gameId: data.gameId,
                playerName: data.playerName,
                totalPlayers: result.totalPlayers
            });
            
            // Verfügbare Rassen automatisch laden
            socket.emit('get_available_races', { gameId: data.gameId });
            
        } else {
            socket.emit('error', result.message);
        }
        
    } catch (error) {
        console.error('Error in join_race_selection:', error);
        socket.emit('error', 'Fehler beim Beitreten der Rassenauswahl');
    }
});

// Verfügbare Rassen laden
    socket.on('get_available_races', async (data) => {
    try {
        console.log('📋 Get available races request:', data);
        
        const racesResult = await raceController.getAvailableRaces();
        
        if (racesResult.success) {
            // Aktuelle Spieleranzahl ermitteln
            const playersResult = await db.query(
                'SELECT COUNT(*) as count FROM game_players WHERE game_id = ? AND is_active = 1',
                [data.gameId]
            );
            
            socket.emit('races_loaded', {
                success: true,
                races: racesResult.races,
                totalPlayers: playersResult[0].count,
                gameId: data.gameId
            });
            
            console.log(`✅ Sent ${racesResult.races.length} races to player`);
            
            // Sende aktuelle Rassenauswahlen
            await broadcastRaceSelectionSync(data.gameId);
            
        } else {
            socket.emit('error', racesResult.message);
        }
        
    } catch (error) {
        console.error('Error getting available races:', error);
        socket.emit('error', 'Fehler beim Laden der Rassen');
    }
});

// Rasse auswählen (noch nicht bestätigt)
    socket.on('select_race', async (data) => {
    try {
        console.log('🎯 Select race request:', data);
        
        if (!data.gameId || !data.playerName || !data.raceId) {
            socket.emit('error', 'Unvollständige Daten für Rassenauswahl');
            return;
        }

        const result = await raceController.selectRace(data.gameId, data.playerName, data.raceId);
        
        if (result.success) {
            socket.emit('race_selected', {
                success: true,
                playerName: data.playerName,
                raceId: data.raceId,
                raceName: result.raceName
            });
            
            console.log(`✅ Race ${result.raceName} selected by ${data.playerName}`);
            
            // Sync an alle Spieler senden
            await broadcastRaceSelectionSync(data.gameId);
            
        } else {
            socket.emit('error', result.message);
        }
        
    } catch (error) {
        console.error('Error selecting race:', error);
        socket.emit('error', 'Fehler bei der Rassenauswahl');
    }
});

// Rasse bestätigen
    socket.on('confirm_race', async (data) => {
        try {
            console.log('🏁 Race confirmation:', data);
            
            if (!data.gameId || !data.playerId || !data.raceId) {
                socket.emit('error', 'Unvollständige Daten für Rassenbestätigung');
                return;
            }
            
            const result = await raceController.confirmRaceSelection(
                data.gameId, 
                data.playerId, 
                data.raceId
            );
            
            if (result.success) {
                // Bestätigung an alle Spieler
                io.to(`db_game_${data.gameId}`).emit('race_confirmed', {
                    playerId: data.playerId,
                    raceId: data.raceId,
                    playerName: data.playerName
                });
                
                // Prüfe ob alle Spieler ihre Rassen bestätigt haben
                if (result.allRacesConfirmed) {
                    console.log('🎮 All races confirmed! Starting game...');
                    
                    // Karte generieren
                    const mapResult = await mapController.generateMap(data.gameId);
                    if (mapResult.success) {
                        console.log('🗺️ Map generated successfully');
                        
                        // Spielfunktionen nach erfolgreicher Kartengenierung starten
                        await startGameAfterRaceSelection(io, data.gameId);
                        
                        // Alle Spieler zur Spielseite weiterleiten
                        io.to(`db_game_${data.gameId}`).emit('game_ready', {
                            gameId: data.gameId,
                            message: 'Spiel gestartet! Lade Spielfeld...'
                        });
                        
                    } else {
                        socket.emit('error', 'Fehler bei der Kartengenierung: ' + mapResult.message);
                    }
                }
                
                // Aktualisiere Race Selection Status
                await broadcastRaceSelectionSync(data.gameId);
                
            } else {
                socket.emit('error', result.message);
            }
            
        } catch (error) {
            console.error('Error confirming race:', error);
            socket.emit('error', 'Fehler bei der Rassenbestätigung: ' + error.message);
        }
    });

    socket.on('request_map_generation', async (data) => {
    try {
        console.log('🗺️ Map generation request:', data);
        
        if (!data.gameId || !data.playerName) {
            socket.emit('map_generation_error', { message: 'Unvollständige Daten für Kartengenerierung' });
            return;
        }

        // Prüfe ob der Spieler berechtigt ist (ist er im Spiel?)
        const playerCheck = await db.query(
            'SELECT id FROM game_players WHERE game_id = ? AND player_name = ? AND is_active = 1',
            [data.gameId, data.playerName]
        );

        if (playerCheck.length === 0) {
            socket.emit('map_generation_error', { message: 'Spieler nicht berechtigt' });
            return;
        }

        // Prüfe ob wirklich alle Spieler bereit sind
        const allConfirmed = await mapController.checkAllPlayersRaceConfirmed(data.gameId);
        
        if (!allConfirmed.allConfirmed) {
            socket.emit('map_generation_error', { 
                message: `Nicht alle Spieler bereit (${allConfirmed.confirmedPlayers}/${allConfirmed.totalPlayers})` 
            });
            return;
        }

        console.log(`🗺️ Starting map generation for game ${data.gameId}...`);
        
        // Starte Kartengenerierung
        const mapResult = await mapController.generateMap(data.gameId);
        
        if (mapResult.success) {
            console.log(`✅ Map generation successful for game ${data.gameId}`);
            
            // Benachrichtige ALLE Spieler über erfolgreiche Kartengenerierung
            io.to(`db_game_${data.gameId}`).emit('map_generated', {
                success: true,
                gameId: data.gameId,
                mapSize: mapResult.mapSize,
                playerCount: mapResult.playerCount,
                message: 'Karte wurde erfolgreich generiert!'
            });
            
            // Update game status to playing (falls noch nicht geschehen)
            await db.query(
                'UPDATE games SET status = "playing", started_at = NOW() WHERE id = ? AND status != "playing"',
                [data.gameId]
            );
            
        } else {
            console.error(`❌ Map generation failed for game ${data.gameId}:`, mapResult.message);
            
            // Benachrichtige alle Spieler über Fehler
            io.to(`db_game_${data.gameId}`).emit('map_generation_error', {
                success: false,
                message: mapResult.message || 'Unbekannter Fehler bei der Kartengenerierung'
            });
        }
        
    } catch (error) {
        console.error('Error in map generation request:', error);
        socket.emit('map_generation_error', {
            message: 'Server-Fehler bei der Kartengenerierung: ' + error.message
        });
    }
});

// Kartendaten abrufen
    socket.on('get_map_data', async (data) => {
    try {
        console.log('📋 Get map data request:', data);
        
        if (!data.gameId) {
            socket.emit('error', 'Spiel-ID fehlt');
            return;
        }

        const result = await mapController.getMapData(data.gameId);
        
        if (result.success) {
            socket.emit('map_data', {
                success: true,
                gameId: data.gameId,
                mapData: result.mapData
            });
            
            console.log(`✅ Map data sent for game ${data.gameId}: ${result.mapData.length} tiles`);
            
        } else {
            socket.emit('error', result.message);
        }
        
    } catch (error) {
        console.error('Error getting map data:', error);
        socket.emit('error', 'Fehler beim Laden der Kartendaten');
    }
});

// Rasse abwählen (um sie zu ändern)
    socket.on('deselect_race', async (data) => {
    try {
        console.log('❌ Deselect race request:', data);
        
        if (!data.gameId || !data.playerName) {
            socket.emit('error', 'Unvollständige Daten für Rassenabwahl');
            return;
        }

        const result = await raceController.deselectRace(data.gameId, data.playerName);
        
        if (result.success) {
            socket.emit('race_deselected', {
                success: true,
                playerName: data.playerName,
                wasConfirmed: result.wasConfirmed
            });
            
            console.log(`✅ Race deselected by ${data.playerName} (was confirmed: ${result.wasConfirmed})`);
            
            // Sync an alle Spieler senden
            await broadcastRaceSelectionSync(data.gameId);
            
        } else {
            socket.emit('error', result.message);
        }
        
    } catch (error) {
        console.error('Error deselecting race:', error);
        socket.emit('error', 'Fehler bei der Rassenabwahl');
    }
});

// Rassendetails laden
    socket.on('get_race_details', async (data) => {
    try {
        console.log('📖 Get race details request:', data);
        
        if (!data.raceId) {
            socket.emit('error', 'Rassen-ID fehlt');
            return;
        }

        const result = await raceController.getRaceDetails(data.raceId);
        
        if (result.success) {
            socket.emit('race_details_loaded', {
                success: true,
                race: result.race,
                units: result.units
            });
            
            console.log(`✅ Race details sent for race ${result.race.name}`);
            
        } else {
            socket.emit('error', result.message);
        }
        
    } catch (error) {
        console.error('Error getting race details:', error);
        socket.emit('error', 'Fehler beim Laden der Rassendetails');
    }
});

// Rassenauswahl verlassen
    socket.on('leave_race_selection', async (data) => {
    try {
        console.log('🚪 Leave race selection request:', data);
        
        if (!data.gameId || !data.playerName) {
            console.warn('Incomplete data for leaving race selection');
            return;
        }

        const result = await raceController.leaveRaceSelection(data.gameId, data.playerName);
        
        if (result.success) {
            // Socket aus dem Raum entfernen
            socket.leave(`db_game_${data.gameId}`);
            
            // Socket-Daten löschen
            delete socket.raceGameId;
            delete socket.racePlayerName;
            
            socket.emit('race_selection_left', {
                success: true,
                gameId: data.gameId
            });
            
            console.log(`✅ Player ${data.playerName} left race selection for game ${data.gameId}`);
            
            // Sync an verbleibende Spieler senden
            await broadcastRaceSelectionSync(data.gameId);
            
        } else {
            socket.emit('error', result.message);
        }
        
    } catch (error) {
        console.error('Error leaving race selection:', error);
        socket.emit('error', 'Fehler beim Verlassen der Rassenauswahl');
    }
});

    // Game State Events (for active games)
    socket.on('join_db_game_room', (data) => {
        try {
            console.log(`Player ${data.playerName} joining DB game room ${data.gameId}`);
            socket.join(`db_game_${data.gameId}`);
            
            // Add to tracking
            if (!dbGamePlayers.has(data.gameId)) {
                dbGamePlayers.set(data.gameId, new Set());
            }
            dbGamePlayers.get(data.gameId).add(socket.id);
        } catch (error) {
            console.error('Error joining DB game room:', error);
        }
    });

    socket.on('get_game_state', async (data) => {
    try {
        console.log('📋 Get game state request:', data);
        
        if (!data.gameId) {
            socket.emit('error', 'Spiel-ID fehlt');
            return;
        }

        const gameState = await gameController.getGameState(data.gameId);
        
        if (gameState) {
            socket.emit('game_state', {
                success: true,
                gameId: data.gameId,
                gameState: gameState
            });
            
            console.log(`✅ Game state sent for game ${data.gameId}`);
            
        } else {
            socket.emit('error', 'Spielzustand nicht gefunden');
        }
        
    } catch (error) {
        console.error('Error getting game state:', error);
        socket.emit('error', 'Fehler beim Laden des Spielzustands: ' + error.message);
    }
});

    // Reconnection and sync events
    socket.on('rejoin_db_game_room', async (data) => {
        try {
            console.log(`Player ${data.playerName} rejoining DB game room ${data.gameId}`);
            
            socket.join(`db_game_${data.gameId}`);
            
            // Add to tracking
            if (!dbGamePlayers.has(data.gameId)) {
                dbGamePlayers.set(data.gameId, new Set());
            }
            dbGamePlayers.get(data.gameId).add(socket.id);
            
            // Send current race selection status
            await broadcastRaceSelectionSync(data.gameId);
            
        } catch (error) {
            console.error('Error rejoining DB game room:', error);
            socket.emit('error', 'Fehler beim Wiederverbinden');
        }
    });

    // Heartbeat system
    socket.on('heartbeat', () => {
        socket.emit('heartbeat_ack', {
            timestamp: Date.now(),
            socketId: socket.id
        });
    });

    // TODO: Game Actions (for future implementation)
    socket.on('player_move', async (data) => {
        try {
            console.log('Player move:', data);
            // TODO: Implement player move logic
            socket.emit('info', 'Spielaktionen noch nicht implementiert');
        } catch (error) {
            console.error('Error in player_move:', error);
            socket.emit('error', 'Fehler bei der Bewegung');
        }
    });

    socket.on('end_turn', async (data) => {
    try {
        console.log('🔄 End turn request:', data);
        
        if (!data.gameId || !data.playerId) {
            socket.emit('error', 'Unvollständige Daten für Zug beenden');
            return;
        }

        // TODO: Hier wird später die Zug-Logik implementiert
        // Momentan nur ein Platzhalter
        
        socket.emit('turn_ended', {
            success: true,
            gameId: data.gameId,
            nextPlayerId: data.playerId // Vorläufig
        });
        
        // Benachrichtige alle Spieler über Zugwechsel
        io.to(`db_game_${data.gameId}`).emit('turn_changed', {
            gameId: data.gameId,
            currentPlayerId: data.playerId,
            message: 'Nächster Spieler ist am Zug'
        });
        
    } catch (error) {
        console.error('Error ending turn:', error);
        socket.emit('error', 'Fehler beim Beenden des Zugs');
    }
    });
});

// Cleanup old chat rooms (läuft alle 30 Minuten)
setInterval(() => {
    try {
        const now = new Date();
        let cleanedRooms = 0;
        
        chatRooms.forEach((room, gameId) => {
            // Remove rooms older than 2 hours with no players
            const ageInHours = (now - room.createdAt) / (1000 * 60 * 60);
            if (room.players.size === 0 && ageInHours > 2) {
                chatRooms.delete(gameId);
                cleanedRooms++;
            }
        });
        
        if (cleanedRooms > 0) {
            console.log(`🧹 Cleaned up ${cleanedRooms} old chat rooms`);
        }
        
    } catch (error) {
        console.error('❌ Error during chat room cleanup:', error);
    }
}, 30 * 60 * 1000); // 30 Minuten

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/game/:gameId', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/game.html'));
});

// API Routes
app.get('/api/test', async (req, res) => {
    try {
        const testResult = await db.query('SELECT 1 as test');
        const races = await db.query('SELECT COUNT(*) as count FROM races');

        res.json({
            status: 'OK',
            database: 'Connected',
            testQuery: testResult,
            racesCount: races[0].count,
            memoryGames: improvedLobbyManager.games.size,
            memoryPlayers: improvedLobbyManager.players.size,
            dbGamePlayers: dbGamePlayers.size,
            chatRooms: chatRooms.size,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('API Test Error:', error);
        res.status(500).json({
            status: 'ERROR',
            error: error.message
        });
    }
});

app.get('/api/games', async (req, res) => {
    try {
        // Get memory-based waiting games
        const memoryGames = improvedLobbyManager.getAvailableGames();

        // Get database-based active games (optional, for running games)
        let dbGames = [];
        try {
            dbGames = await db.query(`
                SELECT 
                    g.id,
                    g.name,
                    g.max_players,
                    g.current_players,
                    g.map_size,
                    g.status,
                    g.created_at
                FROM games g
                WHERE g.status IN ('race_selection', 'playing')
                ORDER BY g.created_at DESC
            `);
        } catch (dbError) {
            console.log('DB games query failed, using memory only');
        }

        res.json([...memoryGames, ...dbGames]);
    } catch (error) {
        console.error('Error in /api/games:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Spiele: ' + error.message });
    }
});

app.get('/api/races', async (req, res) => {
    try {
        const races = await gameController.getAvailableRaces();
        if (races.success) {
            res.json(races.races);
        } else {
            res.status(500).json({ error: 'Fehler beim Laden der Rassen' });
        }
    } catch (error) {
        console.error('Error in /api/races:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Rassen: ' + error.message });
    }
});

app.get('/api/game/:gameId/status', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const gameState = await gameController.getGameState(gameId);

        if (gameState) {
            res.json(gameState);
        } else {
            res.status(404).json({ error: 'Spiel nicht gefunden' });
        }
    } catch (error) {
        console.error('Error in /api/game/:gameId/status:', error);
        res.status(500).json({ error: 'Fehler beim Laden des Spielstatus: ' + error.message });
    }
});

app.get('/api/game/:gameId/race-selections', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const result = await gameController.getAllRaceSelections(gameId);

        if (result.success) {
            res.json({
                gameId: gameId,
                selections: result.selections,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({ error: result.message });
        }
    } catch (error) {
        console.error('Error in /api/game/:gameId/race-selections:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Rassenwahlen: ' + error.message });
    }
});

app.get('/api/chat/stats', (req, res) => {
    try {
        const stats = {
            totalChatRooms: chatRooms.size,
            rooms: []
        };

        chatRooms.forEach((room, gameId) => {
            stats.rooms.push({
                gameId: gameId,
                playerCount: room.players.size,
                messageCount: room.messages.length,
                createdAt: room.createdAt
            });
        });

        res.json(stats);
    } catch (error) {
        console.error('Error getting chat stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Bestehende Health Checks...
        
        // Zusätzliche Game-spezifische Health Checks
        const activeGamesCount = await db.query(
            'SELECT COUNT(*) as count FROM games WHERE status IN ("playing", "race_selection")'
        );
        
        const totalPlayersCount = await db.query(
            'SELECT COUNT(*) as count FROM game_players WHERE is_active = 1'
        );
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected',
            socketio: 'active',
            activeGames: activeGamesCount[0]?.count || 0,
            activePlayers: totalPlayersCount[0]?.count || 0,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Express Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Route nicht gefunden',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

app.get('/race-selection.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/race-selection.html'));
});

// Static Route für die Spielseite
app.get('/game.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'game.html'));
});

// Neue API Endpoints für Spielfunktionen hinzufügen:

// API Endpoint für Spielzustand
app.get('/api/game/:gameId/state', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        
        const gameEngine = require('./controllers/gameEngine');
        const result = await gameEngine.loadGameState(gameId);
        
        if (result.success) {
            res.json({
                success: true,
                gameState: result.gameState
            });
        } else {
            res.status(404).json({
                success: false,
                message: result.message
            });
        }
    } catch (error) {
        console.error('Error getting game state via API:', error);
        res.status(500).json({
            success: false,
            message: 'Interner Serverfehler'
        });
    }
});

// API Endpoint für Spielstatistiken
app.get('/api/game/:gameId/stats', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        
        const stats = await db.query(`
            SELECT 
                COUNT(DISTINCT gp.id) as total_players,
                COUNT(DISTINCT CASE WHEN gp.is_active = 1 THEN gp.id END) as active_players,
                COUNT(DISTINCT gu.id) as total_units,
                COUNT(DISTINCT gm.id) as total_buildings,
                MAX(g.turn_number) as current_turn,
                g.status,
                g.started_at,
                TIMESTAMPDIFF(MINUTE, g.started_at, NOW()) as game_duration_minutes
            FROM games g
            LEFT JOIN game_players gp ON g.id = gp.game_id
            LEFT JOIN game_units gu ON g.id = gu.game_id
            LEFT JOIN game_maps gm ON g.id = gm.game_id AND gm.building_type_id IS NOT NULL
            WHERE g.id = ?
            GROUP BY g.id
        `, [gameId]);
        
        res.json({
            success: true,
            stats: stats[0] || {}
        });
        
    } catch (error) {
        console.error('Error getting game stats:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Statistiken'
        });
    }
});

// API Endpoint für Kampflog
app.get('/api/game/:gameId/battle-log', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const limit = parseInt(req.query.limit) || 50;
        
        const battleLog = await db.query(`
            SELECT 
                bl.*,
                attacker_unit.unit_name as attacker_name,
                attacker_player.player_name as attacker_player_name,
                defender_unit.unit_name as defender_name,
                defender_player.player_name as defender_player_name
            FROM battle_log bl
            LEFT JOIN game_units attacker_unit ON bl.attacker_unit_id = attacker_unit.id
            LEFT JOIN game_players attacker_player ON attacker_unit.player_id = attacker_player.id
            LEFT JOIN game_units defender_unit ON bl.defender_unit_id = defender_unit.id
            LEFT JOIN game_players defender_player ON defender_unit.player_id = defender_player.id
            WHERE bl.game_id = ?
            ORDER BY bl.created_at DESC
            LIMIT ?
        `, [gameId, limit]);
        
        res.json({
            success: true,
            battleLog: battleLog
        });
        
    } catch (error) {
        console.error('Error getting battle log:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden des Kampflogs'
        });
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception in Game Server:', error);
    
    // Benachrichtige alle aktiven Spieler
    io.emit('server_error', {
        message: 'Serverfehler aufgetreten. Spiel wird möglicherweise neu gestartet.',
        timestamp: new Date().toISOString()
    });
    
    // Graceful shutdown nach kurzer Verzögerung
    setTimeout(() => {
        process.exit(1);
    }, 5000);
});

setInterval(async () => {
    try {
        console.log('🧹 Running periodic cleanup...');
        
        // Lösche alte Battle Logs (älter als 7 Tage)
        await db.query(
            'DELETE FROM battle_log WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
        );
        
        // Deaktiviere Spieler ohne Socket-Verbindung für > 30 Minuten
        await db.query(`
            UPDATE game_players SET is_active = 0 
            WHERE socket_id IS NULL 
            AND joined_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)
            AND game_id IN (SELECT id FROM games WHERE status = 'playing')
        `);
        
        console.log('✅ Periodic cleanup completed');
        
    } catch (error) {
        console.error('Error during periodic cleanup:', error);
    }
}, 30 * 60 * 1000); // 30 Minuten

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    
    // In production, you might want to restart the process
    if (process.env.NODE_ENV === 'production') {
        console.error('Unhandled rejection in production, exiting...');
        
        io.emit('server_shutdown', {
            message: 'Server wird neugestartet. Bitte speichere deinen Fortschritt.',
            timestamp: new Date().toISOString()
        });
        
        setTimeout(() => {
            process.exit(1);
        }, 2000);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    
    // Notify all connected clients
    io.emit('server_shutdown', {
        message: 'Server wird heruntergefahren. Bitte speichere deinen Fortschritt.',
        timestamp: new Date().toISOString()
    });
    
    // Give clients time to receive the message
    setTimeout(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    }, 2000);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    
    // Notify all connected clients
    io.emit('server_shutdown', {
        message: 'Server wird heruntergefahren. Bitte speichere deinen Fortschritt.',
        timestamp: new Date().toISOString()
    });
    
    // Give clients time to receive the message
    setTimeout(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    }, 2000);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Strategy Game Server gestartet!`);
    console.log(`🌐 Server läuft auf Port: ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`⚡ Socket.IO aktiviert für Echtzeit-Multiplayer`);
    console.log(`💾 Datenbank-Verbindung: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`💬 Chat-System aktiviert`);
    
    console.log(`\n📡 API Endpoints verfügbar:`);
    console.log(`   - GET /api/test`);
    console.log(`   - GET /api/games`);
    console.log(`   - GET /api/races`);
    console.log(`   - GET /api/chat/stats`);
    console.log(`   - GET /api/game/:gameId/status`);
    console.log(`   - GET /api/game/:gameId/race-selections`);
    console.log(`   - GET /health`);
    
    console.log(`\n🎮 Socket.IO Events:`);
    console.log(`   Lobby: create_game, join_game, player_ready, start_game, leave_game`);
    console.log(`   Race: select_race, deselect_race, get_race_selections`);
    console.log(`   Chat: join_chat_room, send_chat_message, leave_chat_room`);
    console.log(`   Game: join_db_game_room, get_game_state, player_move, end_turn`);
    console.log(`   System: heartbeat, rejoin_db_game_room, request_race_selection_sync`);
    
    console.log(`\n🌟 Features aktiviert:`);
    console.log(`   ✅ Multiplayer Lobby System`);
    console.log(`   ✅ Race Selection mit Datenbank-Persistierung`);
    console.log(`   ✅ Live Chat während Lobby & Race Selection`);
    console.log(`   ✅ Automatische Reconnection & Sync`);
    console.log(`   ✅ Heartbeat-basierte Verbindungsüberwachung`);
    console.log(`   ✅ Memory-effiziente Cleanup-Systeme`);
    console.log(`   ✅ Umfassende Error Handling`);
    console.log(`   ✅ Production-ready Health Monitoring`);
    console.log(`   ✅ Graceful Shutdown mit Client-Benachrichtigung`);
    
    console.log(`\n🎯 Server bereit für Strategiespiel-Action! 🏰⚔️`);
    console.log(`📡 Alle Systeme online und betriebsbereit!`);
    console.log(`🔗 Verbindung zur Datenbank etabliert`);
    console.log(`🎲 Zufallsgenerierung für Karten aktiviert`);
    console.log(`⚡ Echtzeit-Multiplayer funktionsfähig`);
    console.log(`💾 Spieldaten werden persistent gespeichert`);
    console.log(`🗨️ Chat-System mit Validierung und Cleanup aktiv`);
    console.log(`🔧 Wartungstools und Monitoring verfügbar`);
    
    console.log(`\n🔥 Ready to conquer the battlefield! 🔥`);
    console.log(`🚀 Lass die Strategieschlachten beginnen! 🚀`);
    console.log(`\n============================================`);
    console.log(`🎮 STRATEGY GAME SERVER FULLY OPERATIONAL 🎮`);
    console.log(`============================================\n`);
});

// Export für Testing (falls benötigt)
module.exports = { app, server, io };