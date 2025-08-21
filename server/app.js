const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import Controllers und Event Handlers
const improvedLobbyManager = require('./controllers/improvedLobbyManager');
const gameController = require('./controllers/gameController');
const db = require('./config/database');
const raceController = require('./controllers/raceController');
const { setupRaceSelectionEvents } = require('./events/raceSocketEvents');

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

// Hilfsfunktion für Race Selection Synchronisation
async function broadcastRaceSelectionSync(gameId) {
    try {
        console.log(`Broadcasting race selection sync for game ${gameId}`);
        
        const result = await gameController.getAllRaceSelections(gameId);
        if (result.success) {
            io.to(`db_game_${gameId}`).emit('race_selection_sync', {
                gameId: gameId,
                selections: result.selections,
                timestamp: new Date().toISOString()
            });
            
            console.log(`✓ Race selection sync broadcasted to game ${gameId}`);
        }
    } catch (error) {
        console.error('Error broadcasting race selection sync:', error);
    }
}

// Setup Game Lobby Events
function setupGameLobbyEvents(socket) {
    // Join game
    socket.on('join_game', (data) => {
        try {
            console.log('Join game request:', data);
            const result = improvedLobbyManager.joinGame(socket.id, data.gameId, data.playerName);
            
            if (result.success) {
                socket.join(`game_${data.gameId}`);
                socket.emit('game_joined', result);
                
                // Notify all players in the game
                io.to(`game_${data.gameId}`).emit('player_joined', {
                    playerName: data.playerName,
                    players: result.players
                });
                
                // Broadcast updated games list to all clients
                io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                
                console.log(`Player ${data.playerName} joined game ${data.gameId}`);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in join_game:', error);
            socket.emit('error', 'Fehler beim Beitreten des Spiels');
        }
    });

    // Player ready
    socket.on('player_ready', (data) => {
        try {
            console.log('Player ready:', data);
            const result = improvedLobbyManager.togglePlayerReady(data.gameId, data.playerName);
            
            if (result.success) {
                // Notify all players in the game
                io.to(`game_${data.gameId}`).emit('player_ready_status', {
                    playerName: data.playerName,
                    isReady: result.isReady,
                    players: result.players,
                    canStart: result.canStart,
                    allReady: result.allReady
                });
                
                console.log(`Player ${data.playerName} ready status: ${result.isReady}`);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in player_ready:', error);
            socket.emit('error', 'Fehler beim Setzen des Bereit-Status');
        }
    });

    // Start game
    socket.on('start_game', async (data) => {
        try {
            console.log('Start game request:', data);
            
            // Zuerst prüfen ob alle Spieler bereit sind
            const game = improvedLobbyManager.getGame(data.gameId);
            if (!game) {
                socket.emit('error', 'Spiel nicht gefunden');
                return;
            }

            const allReady = game.players.every(player => player.isReady);
            if (!allReady) {
                socket.emit('error', 'Nicht alle Spieler sind bereit');
                return;
            }

            // Spiel in Datenbank erstellen
            const dbResult = await gameController.createGame(data.gameId, game);
            if (dbResult.success) {
                // Memory-Game als "started" markieren
                improvedLobbyManager.startGame(data.gameId);
                
                // Alle Spieler benachrichtigen
                io.to(`game_${data.gameId}`).emit('game_starting', {
                    message: 'Spiel startet! Wechsle zur Rassenauswahl...',
                    gameId: data.gameId
                });

                // Kurz warten, dann zur Rassenauswahl weiterleiten
                setTimeout(() => {
                    io.to(`game_${data.gameId}`).emit('redirect_to_race_selection', {
                        gameId: data.gameId,
                        url: `/race-selection.html?gameId=${data.gameId}`
                    });
                }, 2000);

                // Games list aktualisieren
                io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                
                console.log(`✓ Game ${data.gameId} started and moved to race selection`);
            } else {
                socket.emit('error', dbResult.message || 'Fehler beim Erstellen des Spiels in der Datenbank');
            }
        } catch (error) {
            console.error('Error in start_game:', error);
            socket.emit('error', 'Fehler beim Starten des Spiels: ' + error.message);
        }
    });

    // Leave game
    socket.on('leave_game', (data) => {
        try {
            console.log('Leave game request:', data);
            const result = improvedLobbyManager.removePlayer(data.gameId, socket.id);
            
            if (result.success) {
                socket.leave(`game_${data.gameId}`);
                
                // Notify other players
                socket.to(`game_${data.gameId}`).emit('player_left', {
                    playerName: data.playerName,
                    players: result.players
                });
                
                // If game was destroyed, notify everyone
                if (result.gameDestroyed) {
                    socket.to(`game_${data.gameId}`).emit('game_destroyed', {
                        message: 'Spiel wurde aufgelöst'
                    });
                }
                
                // Broadcast updated games list
                io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                
                console.log(`Player left game ${data.gameId}`);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in leave_game:', error);
            socket.emit('error', 'Fehler beim Verlassen des Spiels');
        }
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        try {
            console.log(`Socket ${socket.id} disconnected`);
            const result = improvedLobbyManager.handleDisconnect(socket.id);
            
            if (result.gamesAffected.length > 0) {
                result.gamesAffected.forEach(gameData => {
                    if (gameData.gameDestroyed) {
                        io.to(`game_${gameData.gameId}`).emit('game_destroyed', {
                            message: 'Spiel wurde aufgelöst (Host getrennt)'
                        });
                    } else {
                        io.to(`game_${gameData.gameId}`).emit('player_left', {
                            playerName: gameData.playerName,
                            players: gameData.players
                        });
                    }
                });
                
                // Broadcast updated games list
                io.emit('games_updated', improvedLobbyManager.getAvailableGames());
            }
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/game/:gameId', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/game.html'));
});

app.get('/race-selection', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/race-selection.html'));
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
            const activeGames = await db.query('SELECT id, status, created_at FROM games WHERE status IN ("race_selection", "playing")');
            dbGames = activeGames.map(game => ({
                id: game.id,
                status: game.status,
                type: 'database',
                created_at: game.created_at
            }));
        } catch (dbError) {
            console.warn('Could not fetch database games:', dbError.message);
        }
        
        res.json({
            memoryGames: memoryGames,
            databaseGames: dbGames,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in /api/games:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/races', async (req, res) => {
    try {
        const races = await db.query('SELECT id, name, description, color_hex FROM races ORDER BY name');
        res.json(races);
    } catch (error) {
        console.error('Error in /api/races:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Rassen: ' + error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

app.get('/api/game/:gameId/status', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const gameInfo = await gameController.getGameInfo(gameId);
        
        if (gameInfo.success) {
            res.json(gameInfo.game);
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
            res.json(result.selections);
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

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    setupGameLobbyEvents(socket);
    setupRaceSelectionEvents(io, socket); // Rassenauswahl Events aus separater Datei

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
            socket.emit('error', 'Fehler beim Erstellen des Spiels');
        }
    });

    // Chat Events
    socket.on('join_chat_room', (data) => {
        try {
            if (!data.gameId || !data.playerName) {
                socket.emit('error', 'Game ID und Player Name erforderlich für Chat');
                return;
            }
            
            const chatRoom = getChatRoom(data.gameId);
            
            // Add player to chat room tracking
            chatRoom.players.add(socket.id);
            
            // Join socket room
            socket.join(`chat_${data.gameId}`);
            
            // Send chat history to the joining player
            socket.emit('chat_history', {
                gameId: data.gameId,
                messages: chatRoom.messages
            });
            
            // Notify other players about new player
            socket.to(`chat_${data.gameId}`).emit('chat_player_joined', {
                playerName: data.playerName,
                playerCount: chatRoom.players.size
            });
            
            // Send updated player count to everyone
            io.to(`chat_${data.gameId}`).emit('chat_player_count', {
                count: chatRoom.players.size
            });
            
            console.log(`✅ Player ${data.playerName} joined chat for game ${data.gameId} (${chatRoom.players.size} players)`);
            
        } catch (error) {
            console.error('❌ Error joining chat room:', error);
            socket.emit('error', 'Fehler beim Beitreten des Chat-Raums');
        }
    });

    socket.on('send_chat_message', (data) => {
        try {
            if (!data.gameId || !data.playerName || !data.message) {
                socket.emit('error', 'Unvollständige Chat-Nachricht');
                return;
            }
            
            // Validate message
            const validation = validateChatMessage(data.message);
            if (!validation.valid) {
                socket.emit('error', validation.reason);
                return;
            }
            
            // Add message to room
            const chatMessage = addChatMessage(data.gameId, data.playerName, validation.message, socket.id);
            
            // Broadcast message to all players in the chat room
            io.to(`chat_${data.gameId}`).emit('chat_message', {
                id: chatMessage.id,
                gameId: data.gameId,
                playerName: data.playerName,
                message: chatMessage.message,
                timestamp: chatMessage.timestamp,
                playerId: chatMessage.playerId
            });
            
            console.log(`💬 Chat message in game ${data.gameId} from ${data.playerName}: ${validation.message.substring(0, 50)}${validation.message.length > 50 ? '...' : ''}`);
            
        } catch (error) {
            console.error('❌ Error sending chat message:', error);
            socket.emit('error', 'Fehler beim Senden der Nachricht');
        }
    });

    socket.on('leave_chat_room', (data) => {
        try {
            if (!data.gameId || !data.playerName) {
                socket.emit('error', 'Game ID und Player Name erforderlich');
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

    // Race Selection Events (zusätzlich zu denen aus raceSocketEvents.js)
    socket.on('get_available_races', async (data) => {
        try {
            const result = await raceController.getAvailableRaces();
            if (result.success) {
                socket.emit('available_races', result.races);
            } else {
                socket.emit('error', { message: result.message });
            }
        } catch (error) {
            console.error('Error getting available races:', error);
            socket.emit('error', { message: 'Fehler beim Laden der Rassen' });
        }
    });

    socket.on('select_race', async (data) => {
        try {
            console.log(`Race selection by ${data.playerName}: ${data.raceId} for game ${data.gameId}`);
            
            const result = await raceController.selectRace(data.gameId, data.playerName, data.raceId);
            if (result.success) {
                socket.emit('race_selected', {
                    raceId: data.raceId,
                    raceName: result.raceName,
                    message: 'Rasse ausgewählt'
                });

                // Broadcast updated race selection sync
                await broadcastRaceSelectionSync(data.gameId);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in select_race:', error);
            socket.emit('error', 'Fehler bei der Rassenwahl');
        }
    });

    socket.on('confirm_race', async (data) => {
        try {
            console.log(`Race confirmation by ${data.playerName} for game ${data.gameId}`);
            
            const result = await raceController.confirmRace(data.gameId, data.playerName);
            if (result.success) {
                socket.emit('race_confirmed', {
                    message: 'Rasse bestätigt'
                });

                // Prüfe ob alle Spieler bereit sind
                if (result.allReady) {
                    console.log(`All players ready for game ${data.gameId}, starting game...`);
                    
                    // Starte das eigentliche Spiel
                    const startResult = await gameController.startGame(data.gameId);
                    if (startResult.success) {
                        io.to(`db_game_${data.gameId}`).emit('game_started', {
                            message: 'Spiel startet! Karte wird generiert...',
                            gameId: data.gameId
                        });
                    }
                }

                // Broadcast updated race selection sync
                await broadcastRaceSelectionSync(data.gameId);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in confirm_race:', error);
            socket.emit('error', 'Fehler bei der Rassenbestätigung');
        }
    });

    socket.on('deselect_race', async (data) => {
        try {
            console.log(`Race deselection by ${data.playerName} for game ${data.gameId}`);
            
            const result = await raceController.deselectRace(data.gameId, data.playerName);
            if (result.success) {
                socket.emit('race_deselection_confirmed', {
                    message: 'Rassenauswahl zurückgesetzt'
                });

                // Broadcast updated race selection sync
                await broadcastRaceSelectionSync(data.gameId);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in deselect_race:', error);
            socket.emit('error', 'Fehler bei der Rassenabwahl');
        }
    });

    socket.on('get_race_selections', async (data) => {
        try {
            const result = await gameController.getAllRaceSelections(data.gameId);
            if (result.success) {
                socket.emit('race_selections_list', {
                    gameId: data.gameId,
                    selections: result.selections
                });
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error getting race selections:', error);
            socket.emit('error', 'Fehler beim Abrufen der Rassenwahlen');
        }
    });

    socket.on('get_race_details', async (data) => {
        try {
            console.log(`Loading race details for race ${data.raceId}`);
            
            const result = await raceController.getRaceDetails(data.raceId);
            if (result.success) {
                socket.emit('race_details', {
                    success: true,
                    race: result.race,
                    units: result.units
                });
            } else {
                socket.emit('race_details', { success: false, message: result.message });
            }
        } catch (error) {
            console.error('Error getting race details:', error);
            socket.emit('race_details', { success: false, message: 'Fehler beim Laden der Rassendetails' });
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
            const gameState = await gameController.getGameState(data.gameId);
            if (gameState) {
                socket.emit('game_state', gameState);
            } else {
                socket.emit('error', 'Spielstatus nicht gefunden');
            }
        } catch (error) {
            console.error('Error in get_game_state:', error);
            socket.emit('error', 'Fehler beim Laden des Spielstatus: ' + error.message);
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

    socket.on('request_race_selection_sync', async (data) => {
        try {
            console.log(`Race selection sync requested by ${data.playerName} for game ${data.gameId}`);
            
            const result = await gameController.getAllRaceSelections(data.gameId);
            if (result.success) {
                socket.emit('race_selection_sync', {
                    gameId: data.gameId,
                    selections: result.selections,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Error sending race selection sync:', error);
            socket.emit('error', 'Fehler beim Synchronisieren der Rassenwahlen');
        }
    });

    // Heartbeat system
    socket.on('heartbeat', (data) => {
        try {
            socket.emit('heartbeat_response', {
                timestamp: new Date().toISOString(),
                socketId: socket.id
            });
        } catch (error) {
            console.error('Error in heartbeat:', error);
        }
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        try {
            console.log(`User disconnected: ${socket.id}`);
            
            // Cleanup from database game tracking
            dbGamePlayers.forEach((players, gameId) => {
                if (players.has(socket.id)) {
                    players.delete(socket.id);
                    console.log(`Removed socket ${socket.id} from DB game ${gameId}`);
                    
                    // Clean up empty game sets
                    if (players.size === 0) {
                        dbGamePlayers.delete(gameId);
                        console.log(`Cleaned up empty DB game ${gameId}`);
                    }
                }
            });
            
            // Cleanup from chat rooms
            chatRooms.forEach((room, gameId) => {
                if (room.players.has(socket.id)) {
                    room.players.delete(socket.id);
                    console.log(`Removed socket ${socket.id} from chat room ${gameId}`);
                    
                    // Notify remaining players
                    socket.to(`chat_${gameId}`).emit('chat_player_left', {
                        playerName: 'Ein Spieler',
                        playerCount: room.players.size
                    });
                    
                    // Clean up empty chat rooms
                    if (room.players.size === 0 && room.messages.length === 0) {
                        chatRooms.delete(gameId);
                        console.log(`Cleaned up empty chat room ${gameId}`);
                    }
                }
            });
            
        } catch (error) {
            console.error('Error in disconnect handler:', error);
        }
    });
});

// Periodic cleanup function
setInterval(() => {
    try {
        let cleanedGames = 0;
        let cleanedChats = 0;
        
        // Clean up empty game tracking
        dbGamePlayers.forEach((players, gameId) => {
            if (players.size === 0) {
                dbGamePlayers.delete(gameId);
                cleanedGames++;
            }
        });
        
        // Clean up old/empty chat rooms
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        chatRooms.forEach((room, gameId) => {
            const age = now - room.createdAt.getTime();
            if ((room.players.size === 0 && room.messages.length === 0) || age > maxAge) {
                chatRooms.delete(gameId);
                cleanedChats++;
            }
        });
        
        if (cleanedGames > 0 || cleanedChats > 0) {
            console.log(`🧹 Cleanup: Removed ${cleanedGames} empty game rooms and ${cleanedChats} old chat rooms`);
        }
        
    } catch (error) {
        console.error('Error in periodic cleanup:', error);
    }
}, 15 * 60 * 1000); // Every 15 minutes

// Memory monitoring
setInterval(() => {
    try {
        const memUsage = process.memoryUsage();
        const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        
        console.log(`📊 Memory: ${memMB}MB | Games: ${improvedLobbyManager.games.size} | DB Games: ${dbGamePlayers.size} | Chat Rooms: ${chatRooms.size}`);
        
        // Log if memory usage is high
        if (memMB > 512) {
            console.warn(`⚠️ High memory usage: ${memMB}MB`);
        }
        
    } catch (error) {
        console.error('Error in memory monitoring:', error);
    }
}, 5 * 60 * 1000); // Every 5 minutes

// Graceful shutdown handling
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
    console.log(`   Race: select_race, confirm_race, deselect_race, get_race_selections, get_available_races, get_race_details`);
    console.log(`   Chat: join_chat_room, send_chat_message, leave_chat_room, get_chat_history`);
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
    
    console.log(`\n🎯 Server bereit für Strategiespiel-Action!`);
    
    // Test database connection
    setTimeout(async () => {
        try {
            await db.query('SELECT 1');
            console.log('✅ Datenbank-Verbindung erfolgreich getestet');
        } catch (error) {
            console.error('❌ Datenbank-Verbindungsfehler:', error.message);
        }
    }, 1000);
});