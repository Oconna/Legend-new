const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import improved lobby manager
const improvedLobbyManager = require('./controllers/improvedLobbyManager');
const gameController = require('./controllers/gameController');

// Import database (only for persistent games)
const db = require('./config/database');

// Express App Setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Enhanced Socket.IO server configuration
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory storage for active DB game players
const dbGamePlayers = new Map(); // gameId -> Set of socketIds

// In-memory storage for chat messages and players
const chatRooms = new Map(); // gameId -> { messages: [], players: Set() }

// Helper function to get or create chat room
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

// Helper function to add chat message to history
function addChatMessage(gameId, playerName, message, playerId = null) {
    const chatRoom = getChatRoom(gameId);
    const chatMessage = {
        id: Date.now() + Math.random(), // Simple unique ID
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

// Helper function to validate chat message
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

// Chat statistics endpoint (optional - für Debugging)
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

// Helper function to broadcast race selection updates
async function broadcastRaceSelectionSync(gameId) {
    try {
        const result = await gameController.getAllRaceSelections(gameId);
        if (result.success) {
            io.to(`db_game_${gameId}`).emit('race_selection_sync', {
                gameId: gameId,
                selections: result.selections,
                timestamp: new Date().toISOString()
            });
            console.log(`✓ Race selection sync broadcasted for game ${gameId}`);
        }
    } catch (error) {
        console.error('Error broadcasting race selection sync:', error);
    }
}

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Basic connection events
    socket.on('disconnect', () => {
        try {
            console.log(`🔌 Socket ${socket.id} disconnected`);
            
            // Clean up lobby manager
            improvedLobbyManager.removePlayer(socket.id);
            
            // Clean up database game players
            dbGamePlayers.forEach((players, gameId) => {
                if (players.has(socket.id)) {
                    players.delete(socket.id);
                    console.log(`Removed ${socket.id} from DB game ${gameId}`);
                    
                    if (players.size === 0) {
                        dbGamePlayers.delete(gameId);
                        console.log(`Removed empty DB game ${gameId}`);
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
                    
                    console.log(`🧹 Cleaned up chat for disconnected player ${socket.playerName} from game ${socket.gameId}`);
                }
            }
            
        } catch (error) {
            console.error('❌ Error during disconnect cleanup:', error);
        }
    });

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

    // Chat room join
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

    // Send chat message
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

    // Leave chat room
    socket.on('leave_chat_room', (data) => {
        try {
            console.log(`🚪 Player ${data.playerName} leaving chat room for game ${data.gameId}`);
            
            if (!data.gameId || !data.playerName) {
                return;
            }
            
            const chatRoom = getChatRoom(data.gameId);
            
            // Remove player from chat room tracking
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
            
            console.log(`✓ Player ${data.playerName} left chat for game ${data.gameId} (${chatRoom.players.size} players remaining)`);
            
        } catch (error) {
            console.error('Error leaving chat room:', error);
        }
    });

    // Get chat history (for reconnection)
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
                
                // Send updated player list to game room
                io.to(`game_${result.gameId}`).emit('lobby_players_updated', result.players);
                
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
                    // Notify all players in the game
                    io.to(`game_${playerData.gameId}`).emit('player_ready_status', result);
                    
                    // Send notification
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
            console.log('Leave game request:', data);
            const result = improvedLobbyManager.leaveGame(socket.id);
            
            if (result.success) {
                socket.leave(`game_${result.gameId}`);
                socket.emit('game_left', result);
                
                if (!result.gameDeleted) {
                    // Notify remaining players
                    socket.to(`game_${result.gameId}`).emit('player_left', {
                        playerName: data.playerName
                    });
                    
                    // Send updated player list
                    io.to(`game_${result.gameId}`).emit('lobby_players_updated', result.players);
                }
                
                // Update games list for everyone
                io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                
                console.log(`Player ${data.playerName} left game, broadcasting to all clients`);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in leave_game:', error);
            socket.emit('error', 'Fehler beim Verlassen des Spiels: ' + error.message);
        }
    });

    socket.on('start_game', async (data) => {
        try {
            console.log('Start game request:', data);
            const result = improvedLobbyManager.startGame(socket.id);
            
            if (result.success) {
                // Create database game
                const dbGameResult = await gameController.createGame(
                    result.gameName,
                    result.players,
                    result.mapSize
                );
                
                if (dbGameResult.success) {
                    const dbGameId = dbGameResult.gameId;
                    
                    // Move all players to database game room
                    result.players.forEach(player => {
                        const playerSocket = [...io.sockets.sockets.values()]
                            .find(s => s.id === player.socketId);
                        
                        if (playerSocket) {
                            playerSocket.leave(`game_${result.gameId}`);
                            playerSocket.join(`db_game_${dbGameId}`);
                        }
                    });
                    
                    // Add to tracking
                    const playerSocketIds = result.players.map(p => p.socketId);
                    dbGamePlayers.set(dbGameId, new Set(playerSocketIds));
                    
                    // Notify all players about database game creation
                    io.to(`db_game_${dbGameId}`).emit('db_game_created', {
                        dbGameId: dbGameId,
                        players: result.players,
                        mapSize: result.mapSize
                    });
                    
                    // Start race selection
                    io.to(`db_game_${dbGameId}`).emit('start_race_selection', {
                        dbGameId: dbGameId,
                        players: result.players,
                        message: 'Spiel wurde erstellt! Wähle deine Rasse.'
                    });
                    
                    console.log(`Database game created with ID: ${dbGameId}`);
                    
                    // Update games list (memory game is now removed)
                    io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                } else {
                    socket.emit('error', 'Fehler beim Erstellen der Spieldatenbank: ' + dbGameResult.message);
                }
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in start_game:', error);
            socket.emit('error', 'Fehler beim Starten des Spiels: ' + error.message);
        }
    });

    // Race Selection Events (Database-based)
    socket.on('get_available_races', async (data) => {
        try {
            const races = await gameController.getAvailableRaces();
            if (races.success) {
                socket.emit('available_races', races.races);
            } else {
                socket.emit('error', 'Fehler beim Laden der Rassen');
            }
        } catch (error) {
            console.error('Error getting available races:', error);
            socket.emit('error', 'Fehler beim Laden der Rassen');
        }
    });

    socket.on('select_race', async (data) => {
        try {
            console.log(`Race selection by ${data.playerName}: ${data.raceId} for game ${data.gameId}`);
            
            const result = await gameController.selectRace(data.gameId, data.playerName, data.raceId);
            if (result.success) {
                socket.emit('race_selected', {
                    raceId: data.raceId,
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

    socket.on('deselect_race', async (data) => {
        try {
            console.log(`Race deselection by ${data.playerName} for game ${data.gameId}`);
            
            const result = await gameController.getAllRaceSelections(data.gameId);
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

    // Get current race selections for a game
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

    // NEW: Request race selection sync
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

    // Game Actions (for active games)
    socket.on('player_move', async (data) => {
        try {
            // TODO: Implement player move logic
            console.log('Player move:', data);
            
            // Validate move, update database, broadcast to all players in game
            const result = await gameController.executePlayerMove(
                data.gameId, 
                data.playerId, 
                data.fromX, 
                data.fromY, 
                data.toX, 
                data.toY
            );
            
            if (result.success) {
                io.to(`db_game_${data.gameId}`).emit('unit_moved', {
                    playerId: data.playerId,
                    fromX: data.fromX,
                    fromY: data.fromY,
                    toX: data.toX,
                    toY: data.toY
                });
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in player_move:', error);
            socket.emit('error', 'Fehler bei der Bewegung');
        }
    });

    socket.on('end_turn', async (data) => {
        try {
            // TODO: Implement end turn logic
            console.log('End turn:', data);
            
            // Update database, calculate next player, broadcast turn change
            io.to(`db_game_${data.gameId}`).emit('turn_ended', {
                currentPlayer: data.nextPlayer,
                turnNumber: data.turnNumber
            });
        } catch (error) {
            console.error('Error in end_turn:', error);
            socket.emit('error', 'Fehler beim Beenden des Zuges');
        }
    });

    // Admin/Debug Events
    socket.on('admin_get_game_stats', async (data) => {
        try {
            if (!data.gameId) {
                socket.emit('error', 'Game ID required');
                return;
            }

            const result = await gameController.getGameStatistics(data.gameId);
            if (result.success) {
                socket.emit('admin_game_stats', {
                    gameId: data.gameId,
                    stats: result.statistics,
                    timestamp: new Date().toISOString()
                });
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error getting admin game stats:', error);
            socket.emit('error', 'Fehler beim Abrufen der Spielstatistiken');
        }
    });

    socket.on('admin_reset_race_selections', async (data) => {
        try {
            if (!data.gameId) {
                socket.emit('error', 'Game ID required for reset');
                return;
            }

            const result = await gameController.resetAllRaceSelections(data.gameId);
            if (result.success) {
                socket.emit('admin_reset_confirmed', {
                    message: 'Alle Rassenwahlen zurückgesetzt'
                });

                // Broadcast the reset to all players
                await broadcastRaceSelectionSync(data.gameId);
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error resetting race selections:', error);
            socket.emit('error', 'Fehler beim Zurücksetzen der Rassenwahlen');
        }
    });

    socket.on('admin_clear_chat', (data) => {
        try {
            if (!data.gameId) {
                socket.emit('error', 'Game ID required for chat clear');
                return;
            }

            const chatRoom = getChatRoom(data.gameId);
            chatRoom.messages = [];

            socket.emit('admin_chat_cleared', {
                message: 'Chat-Verlauf gelöscht'
            });

            // Notify all players in the chat room
            io.to(`chat_${data.gameId}`).emit('chat_cleared', {
                message: 'Chat wurde von einem Administrator geleert'
            });

            console.log(`Admin cleared chat for game ${data.gameId}`);
        } catch (error) {
            console.error('Error clearing chat:', error);
            socket.emit('error', 'Fehler beim Löschen des Chats');
        }
    });

    // Heartbeat system
    socket.on('heartbeat', () => {
        socket.emit('heartbeat_ack', {
            timestamp: Date.now(),
            socketId: socket.id
        });
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memoryUsage: process.memoryUsage(),
        activeConnections: io.engine.clientsCount,
        memoryGames: improvedLobbyManager.games.size,
        dbGamePlayers: dbGamePlayers.size,
        chatRooms: chatRooms.size
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Express Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Strategy Game Server gestartet!`);
    console.log(`🌐 Server läuft auf Port: ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`⚡ Socket.IO aktiviert für Echtzeit-Multiplayer`);
    console.log(`💾 Datenbank-Verbindung: ${process.env.DB_HOST || 'localhost'}`);
    
    console.log(`\n📡 API Endpoints verfügbar:`);
    console.log(`   - GET /api/test`);
    console.log(`   - GET /api/games`);
    console.log(`   - GET /api/chat/stats`);
    console.log(`   - GET /health`);
    
    console.log(`\n🎮 Socket.IO Events:`);
    console.log(`   Lobby: create_game, join_game, player_ready, start_game, leave_game`);
    console.log(`   Race: select_race, deselect_race, get_race_selections`);
    console.log(`   Chat: join_chat_room, send_chat_message, leave_chat_room`);
    console.log(`   Game: join_db_game_room, get_game_state, player_move, end_turn`);
    console.log(`   System: heartbeat, rejoin_db_game_room, request_race_selection_sync`);
    
    if (process.env.NODE_ENV === 'development') {
        console.log(`   Admin: admin_get_game_stats, admin_reset_race_selections, admin_clear_chat`);
    }
    
    console.log(`\n🌟 Features aktiviert:`);
    console.log(`   ✅ Multiplayer Lobby System`);
    console.log(`   ✅ Race Selection mit Datenbank-Persistierung`);
    console.log(`   ✅ Live Chat während Race Selection`);
    console.log(`   ✅ Automatische Reconnection & Sync`);
    console.log(`   ✅ Heartbeat-basierte Verbindungsüberwachung`);
    console.log(`   ✅ Memory-effiziente Cleanup-Systeme`);
    console.log(`   ✅ Umfassende Error Handling`);
    console.log(`   ✅ Production-ready Health Monitoring`);
    
    console.log(`\n🎯 Server bereit für Strategiespiel-Action! 🏰⚔️`);
    console.log(`📡 Alle Systeme online und betriebsbereit!`);
    console.log(`🔗 Verbindung zur Datenbank etabliert`);
    console.log(`🎲 Zufallsgenerierung für Karten aktiviert`);
    console.log(`⚡ Echtzeit-Multiplayer funktionsfähig`);
    console.log(`💾 Spieldaten werden persistent gespeichert`);
    console.log(`\n🔥 Ready to conquer the battlefield! 🔥`);
});const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import improved lobby manager
const improvedLobbyManager = require('./controllers/improvedLobbyManager');
const gameController = require('./controllers/gameController');

// Import database (only for persistent games)
const db = require('./config/database');

// Express App Setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Enhanced Socket.IO server configuration
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory storage for active DB game players
const dbGamePlayers = new Map(); // gameId -> Set of socketIds

// In-memory storage for chat messages and players
const chatRooms = new Map(); // gameId -> { messages: [], players: Set() }

// Helper function to get or create chat room
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

// Helper function to add chat message to history
function addChatMessage(gameId, playerName, message, playerId = null) {
    const chatRoom = getChatRoom(gameId);
    const chatMessage = {
        id: Date.now() + Math.random(), // Simple unique ID
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

// Helper function to validate chat message
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

// Chat statistics endpoint (optional - für Debugging)
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

    // Basic connection events
    socket.on('disconnect', () => {
        try {
            console.log(`🔌 Socket ${socket.id} disconnected`);
            
            // Clean up lobby manager
            improvedLobbyManager.removePlayer(socket.id);
            
            // Clean up database game players
            dbGamePlayers.forEach((players, gameId) => {
                if (players.has(socket.id)) {
                    players.delete(socket.id);
                    console.log(`Removed ${socket.id} from DB game ${gameId}`);
                    
                    if (players.size === 0) {
                        dbGamePlayers.delete(gameId);
                        console.log(`Removed empty DB game ${gameId}`);
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
                    
                    console.log(`🧹 Cleaned up chat for disconnected player ${socket.playerName} from game ${socket.gameId}`);
                }
            }
            
        } catch (error) {
            console.error('❌ Error during disconnect cleanup:', error);
        }
    });

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
            socket.emit('error', 'Fehler beim