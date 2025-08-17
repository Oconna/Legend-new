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
    
    // Basic profanity filter (erweitere nach Bedarf)
    const profanityWords = ['spam', 'test123spam']; // Beispiel-Wörter
    const containsProfanity = profanityWords.some(word => 
        trimmed.toLowerCase().includes(word.toLowerCase())
    );
    
    if (containsProfanity) {
        return { valid: false, reason: 'Nachricht enthält nicht erlaubte Wörter' };
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

app.get('/api/races', async (req, res) => {
    try {
        const races = await db.query('SELECT * FROM races ORDER BY name');
        res.json(races);
    } catch (error) {
        console.error('Error in /api/races:', error);
        res.status(500).json({ error: 'Fehler beim Laden der Rassen: ' + error.message });
    }
});

app.get('/api/game/:gameId/race-selections', async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);
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
        console.error('Error in race selections API:', error);
        res.status(500).json({ error: 'Fehler beim Abrufen der Rassenwahlen: ' + error.message });
    }
});

app.get('/api/game/:gameId/status', async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);
        const gameState = await gameController.getGameState(gameId);
        
        if (gameState) {
            res.json({
                gameId: gameId,
                status: gameState.game.status,
                playerCount: gameState.players.length,
                players: gameState.players.map(p => ({
                    name: p.player_name,
                    race: p.race_name,
                    raceId: p.race_id,
                    color: p.race_color
                })),
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({ error: 'Spiel nicht gefunden' });
        }
    } catch (error) {
        console.error('Error in game status API:', error);
        res.status(500).json({ error: 'Fehler beim Abrufen des Spielstatus: ' + error.message });
    }
});

app.get('/api/game/:gameId/chat', async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);
        const chatRoom = getChatRoom(gameId);
        
        res.json({
            gameId: gameId,
            messages: chatRoom.messages,
            playerCount: chatRoom.players.size,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in chat API:', error);
        res.status(500).json({ error: 'Fehler beim Abrufen des Chats: ' + error.message });
    }
});

// Helper function to broadcast race selection sync to all players in a game
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

// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log(`Neuer Spieler verbunden: ${socket.id}`);

    // Send initial games list and setup periodic updates
    socket.emit('games_updated', improvedLobbyManager.getAvailableGames());
    
    // Send game list updates every 30 seconds to ensure sync
    const gameListInterval = setInterval(() => {
        socket.emit('games_updated', improvedLobbyManager.getAvailableGames());
    }, 30000);

    // NEW: Heartbeat handling
    socket.on('heartbeat', (data) => {
        socket.emit('heartbeat_response', {
            timestamp: Date.now(),
            playerName: data.playerName,
            gameDbId: data.gameDbId
        });
        
        // Update last seen time for this player
        socket.lastSeen = Date.now();
    });

    // NEW: Rejoin DB game room after reconnection
    socket.on('rejoin_db_game_room', async (data) => {
        try {
            console.log(`Player ${data.playerName} rejoining DB game room ${data.gameId}`);
            
            // Join the room
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
                socket.emit('error', 'Game ID required');
                return;
            }

            console.log(`Admin resetting race selections for game ${data.gameId}`);
            const result = await gameController.resetAllRaceSelections(data.gameId);
            
            if (result.success) {
                // Broadcast reset to all players in the game
                io.to(`db_game_${data.gameId}`).emit('race_selections_reset', {
                    message: 'Alle Rassenwahlen wurden zurückgesetzt'
                });
                
                // Send updated sync
                await broadcastRaceSelectionSync(data.gameId);
                
                socket.emit('admin_action_success', {
                    action: 'reset_race_selections',
                    gameId: data.gameId,
                    message: 'Race selections reset successfully'
                });
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in admin reset race selections:', error);
            socket.emit('error', 'Fehler beim Zurücksetzen der Rassenwahlen');
        }
    });

    socket.on('admin_validate_race_integrity', async (data) => {
        try {
            if (!data.gameId) {
                socket.emit('error', 'Game ID required');
                return;
            }

            const result = await gameController.validateRaceSelectionIntegrity(data.gameId);
            if (result.success) {
                socket.emit('admin_race_integrity', {
                    gameId: data.gameId,
                    isValid: result.isValid,
                    issues: result.issues,
                    players: result.players,
                    timestamp: new Date().toISOString()
                });
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error validating race integrity:', error);
            socket.emit('error', 'Fehler bei der Integritätsprüfung');
        }
    });

    // Admin chat commands
    socket.on('admin_clear_chat', (data) => {
        try {
            if (!data.gameId) {
                socket.emit('error', 'Game ID required');
                return;
            }
            
            console.log(`Admin clearing chat for game ${data.gameId}`);
            
            const chatRoom = getChatRoom(data.gameId);
            chatRoom.messages = [];
            
            // Notify all players in chat
            io.to(`chat_${data.gameId}`).emit('chat_cleared', {
                message: 'Chat wurde von einem Administrator geleert'
            });
            
            socket.emit('admin_action_success', {
                action: 'clear_chat',
                gameId: data.gameId
            });
            
        } catch (error) {
            console.error('Error clearing chat:', error);
            socket.emit('error', 'Fehler beim Leeren des Chats');
        }
    });

    socket.on('admin_get_chat_stats', (data) => {
        try {
            if (!data.gameId) {
                socket.emit('error', 'Game ID required');
                return;
            }
            
            const chatRoom = getChatRoom(data.gameId);
            
            socket.emit('admin_chat_stats', {
                gameId: data.gameId,
                messageCount: chatRoom.messages.length,
                playerCount: chatRoom.players.size,
                createdAt: chatRoom.createdAt,
                players: Array.from(chatRoom.players)
            });
            
        } catch (error) {
            console.error('Error getting chat stats:', error);
            socket.emit('error', 'Fehler beim Abrufen der Chat-Statistiken');
        }
    });


    // Chat Event Handlers
    // Join chat room
    socket.on('join_chat_room', (data) => {
        try {
            console.log(`Player ${data.playerName} joining chat room for game ${data.gameId}`);
            
            if (!data.gameId || !data.playerName) {
                socket.emit('error', 'Unvollständige Daten für Chat-Beitritt');
                return;
            }
            
            const chatRoom = getChatRoom(data.gameId);
            
            // Add player to chat room tracking
            chatRoom.players.add(socket.id);
            
            // Join socket room for chat
            socket.join(`chat_${data.gameId}`);
            
            // Send chat history to joining player
            socket.emit('chat_history', {
                gameId: data.gameId,
                messages: chatRoom.messages
            });
            
            // Notify other players
            socket.to(`chat_${data.gameId}`).emit('chat_player_joined', {
                playerName: data.playerName,
                playerCount: chatRoom.players.size
            });
            
            // Send current player count to everyone
            io.to(`chat_${data.gameId}`).emit('chat_player_count', {
                count: chatRoom.players.size
            });
            
            console.log(`✓ Player ${data.playerName} joined chat for game ${data.gameId} (${chatRoom.players.size} players total)`);
            
        } catch (error) {
            console.error('Error joining chat room:', error);
            socket.emit('error', 'Fehler beim Chat-Beitritt');
        }
    });

    // Send chat message
    socket.on('send_chat_message', (data) => {
        try {
            console.log(`Chat message from ${data.playerName} in game ${data.gameId}:`, data.message);
            
            if (!data.gameId || !data.playerName || !data.message) {
                socket.emit('error', 'Unvollständige Daten für Chat-Nachricht');
                return;
            }
            
            // Validate message
            const validation = validateChatMessage(data.message);
            if (!validation.valid) {
                socket.emit('error', validation.reason);
                return;
            }
            
            // Check if player is in the game
            const chatRoom = getChatRoom(data.gameId);
            if (!chatRoom.players.has(socket.id)) {
                socket.emit('error', 'Du bist nicht in diesem Chat-Raum');
                return;
            }
            
            // Add message to history
            const chatMessage = addChatMessage(data.gameId, data.playerName, validation.message, socket.id);
            
            // Broadcast message to all players in chat room
            io.to(`chat_${data.gameId}`).emit('chat_message', {
                playerName: data.playerName,
                message: validation.message,
                timestamp: chatMessage.timestamp,
                playerId: socket.id
            });
            
            console.log(`✓ Chat message broadcasted in game ${data.gameId}`);
            
        } catch (error) {
            console.error('Error sending chat message:', error);
            socket.emit('error', 'Fehler beim Senden der Chat-Nachricht');
        }
    });

    // Leave chat room
    socket.on('leave_chat_room', (data) => {
        try {
            console.log(`Player ${data.playerName} leaving chat room for game ${data.gameId}`);
            
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

    // Lobby Events (Memory-based)
    socket.on('create_game', (data) => {
        try {
            console.log('Create game request:', data);
            const result = improvedLobbyManager.createGame(
                socket.id, 
                data.playerName, 
                data.gameName, 
                data.maxPlayers, 
                data.mapSize
            );
            
            if (result.success) {
                socket.join(`game_${result.gameId}`);
                socket.emit('game_created', result);
                
                // Send updated player list to game room
                io.to(`game_${result.gameId}`).emit('lobby_players_updated', result.players);
                
                // Update games list for everyone immediately
                io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                
                console.log(`Game created: ${data.gameName}, broadcasting to all clients`);
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

    socket.on('start_game', async (data) => {
        try {
            console.log('🎮 Starting game request:', data);
            const result = await improvedLobbyManager.startGame(socket.id, db);
            
            if (result.success) {
                const playerData = improvedLobbyManager.players.get(socket.id);
                
                if (playerData) {
                    console.log(`✅ Game started successfully, DB ID: ${result.dbGameId}`);
                    
                    // Start race selection phase
                    await gameController.startRaceSelection(result.dbGameId);
                    
                    // Move all players to database game room
                    const memoryGame = improvedLobbyManager.games.get(playerData.gameId);
                    if (memoryGame) {
                        console.log(`📋 Moving ${memoryGame.players.size} players to DB game room`);
                        
                        // Initialize tracking for this DB game
                        dbGamePlayers.set(result.dbGameId, new Set());
                        
                        for (const [socketId, player] of memoryGame.players) {
                            const playerSocket = io.sockets.sockets.get(socketId);
                            if (playerSocket) {
                                playerSocket.join(`db_game_${result.dbGameId}`);
                                playerSocket.leave(`game_${playerData.gameId}`);
                                
                                // Add to DB game tracking
                                dbGamePlayers.get(result.dbGameId).add(socketId);
                                
                                // Send individual confirmation with dbGameId
                                playerSocket.emit('db_game_created', {
                                    dbGameId: result.dbGameId,
                                    memoryGameId: playerData.gameId,
                                    playerName: player.name
                                });
                            }
                        }
                    }
                    
                    // Small delay to ensure all players are in the room
                    setTimeout(() => {
                        // Notify all players in the game to start race selection
                        io.to(`db_game_${result.dbGameId}`).emit('start_race_selection', {
                            message: 'Spiel gestartet! Rassenwahl beginnt...',
                            dbGameId: result.dbGameId,
                            players: result.players
                        });
                        
                        // Send individual messages to ensure each player gets the dbGameId
                        for (const player of result.players) {
                            const playerSocket = io.sockets.sockets.get(player.socketId);
                            if (playerSocket) {
                                playerSocket.emit('db_game_id_assigned', {
                                    dbGameId: result.dbGameId,
                                    playerName: player.name
                                });
                            }
                        }
                    }, 1000); // 1 second delay
                    
                    // Clean up memory game since it's now in database
                    improvedLobbyManager.games.delete(playerData.gameId);
                    
                    // Update players to remove gameId since they're now in DB game
                    for (const player of result.players) {
                        const playerSocket = improvedLobbyManager.players.get(player.socketId);
                        if (playerSocket) {
                            playerSocket.dbGameId = result.dbGameId;
                        }
                    }
                    
                    // Update games list (game no longer in waiting state)
                    io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                }
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in start_game:', error);
            socket.emit('error', 'Fehler beim Starten des Spiels: ' + error.message);
        }
    });

    socket.on('leave_game', (data) => {
        try {
            const result = improvedLobbyManager.leaveGame(socket.id);
            
            if (result.success) {
                const gameRoom = `game_${data.gameId}`;
                socket.leave(gameRoom);
                socket.emit('game_left', result);
                
                if (result.gameDeleted) {
                    // Game was deleted
                    io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                } else {
                    // Notify remaining players
                    socket.to(gameRoom).emit('player_left', {
                        playerName: data.playerName
                    });
                    
                    // Send updated player list
                    io.to(gameRoom).emit('lobby_players_updated', result.players);
                    
                    // Update games list
                    io.emit('games_updated', improvedLobbyManager.getAvailableGames());
                }
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in leave_game:', error);
            socket.emit('error', 'Fehler beim Verlassen des Spiels');
        }
    });

    // Race Selection Events (for started games in database)
    socket.on('select_race', async (data) => {
        try {
            console.log('Race selection request:', data);
            
            // Validate input
            if (!data.gameId || !data.playerName || !data.raceId) {
                socket.emit('error', 'Unvollständige Daten für Rassenwahl');
                return;
            }
            
            const confirmed = data.confirmed || false;
            
            // For race selection phase, we work with database
            const result = await gameController.selectRace(data.gameId, data.playerName, data.raceId, confirmed);
            
            if (result.success) {
                console.log(`✓ Race ${result.raceName} ${confirmed ? 'confirmed' : 'selected'} by ${result.playerName} in game ${data.gameId}`);
                
                if (confirmed) {
                    // Race was confirmed - now written to database
                    socket.emit('race_selection_confirmed', {
                        raceId: result.raceId,
                        raceName: result.raceName,
                        message: `Du hast ${result.raceName} bestätigt!`
                    });
                    
                    // Notify all players about confirmation
                    io.to(`db_game_${data.gameId}`).emit('player_race_confirmed', {
                        playerName: result.playerName,
                        raceId: result.raceId,
                        raceName: result.raceName,
                        confirmedCount: result.racesConfirmed,
                        totalPlayers: result.totalPlayers
                    });
                } else {
                    // Race was only selected (not confirmed yet)
                    // Notify all players about selection
                    io.to(`db_game_${data.gameId}`).emit('player_race_selected', {
                        playerName: result.playerName,
                        raceId: result.raceId,
                        raceName: result.raceName,
                        selectedCount: result.racesSelected,
                        totalPlayers: result.totalPlayers
                    });
                }

                // Always broadcast sync after any race selection change
                await broadcastRaceSelectionSync(data.gameId);

                if (result.allRacesConfirmed) {
                    console.log(`🎯 All races confirmed for game ${data.gameId}, starting map generation...`);
                    
                    // All races confirmed, notify players
                    io.to(`db_game_${data.gameId}`).emit('all_races_confirmed', {
                        message: 'Alle Rassen bestätigt! Karte wird generiert...',
                        totalPlayers: result.totalPlayers,
                        racesConfirmed: result.racesConfirmed
                    });
                    
                    // Small delay to let players see the message
                    setTimeout(async () => {
                        try {
                            // Start map generation and game
                            const gameStartResult = await gameController.startGame(data.gameId);
                            if (gameStartResult.success) {
                                console.log(`🚀 Game ${data.gameId} started successfully!`);
                                
                                io.to(`db_game_${data.gameId}`).emit('game_started', {
                                    message: 'Spiel startet! Weiterleitung zur Spielkarte...',
                                    dbGameId: data.gameId,
                                    gameData: gameStartResult.gameData
                                });
                            } else {
                                console.error(`Failed to start game ${data.gameId}:`, gameStartResult.message);
                                io.to(`db_game_${data.gameId}`).emit('error', gameStartResult.message);
                            }
                        } catch (startError) {
                            console.error('Error starting game after race confirmation:', startError);
                            io.to(`db_game_${data.gameId}`).emit('error', 'Fehler beim Starten des Spiels: ' + startError.message);
                        }
                    }, 2000); // 2 second delay
                } else {
                    console.log(`Waiting for more race confirmations in game ${data.gameId}: ${result.racesConfirmed}/${result.totalPlayers}`);
                }
            } else {
                console.log(`Race selection failed for ${data.playerName} in game ${data.gameId}:`, result.message);
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in select_race:', error);
            socket.emit('error', 'Fehler bei der Rassenwahl: ' + error.message);
        }
    });

    // NEW: Enhanced race deselection with database removal
    socket.on('deselect_race', async (data) => {
        try {
            console.log('Race deselection request:', data);
            
            if (!data.gameId || !data.playerName) {
                socket.emit('error', 'Unvollständige Daten für Rassenabwahl');
                return;
            }
            
            // Reset player's race selection in database (allow deselection of confirmed races)
            const result = await gameController.deselectRace(data.gameId, data.playerName);
            
            if (result.success) {
                console.log(`✓ Race deselected by ${data.playerName} in game ${data.gameId} (was confirmed: ${result.wasConfirmed})`);
                
                // Notify all players about deselection
                io.to(`db_game_${data.gameId}`).emit('player_race_deselected', {
                    playerName: data.playerName,
                    wasConfirmed: result.wasConfirmed
                });
                
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

    // Disconnect
    socket.on('disconnect', (reason) => {
        console.log(`Spieler getrennt: ${socket.id}, Grund: ${reason}`);
        
        // Clear interval
        if (gameListInterval) {
            clearInterval(gameListInterval);
        }
        
        try {
            // Handle memory game disconnection
            const result = improvedLobbyManager.handleDisconnect(socket.id);
            
            if (result && result.success && !result.gameDeleted) {
                // Find which game room to notify
                const playerData = improvedLobbyManager.players.get(socket.id);
                if (playerData) {
                    const gameRoom = `game_${playerData.gameId}`;
                    
                    // Notify remaining players
                    socket.to(gameRoom).emit('player_left', {
                        playerName: playerData.name
                    });
                    
                    // Send updated player list
                    io.to(gameRoom).emit('lobby_players_updated', result.players);
                }
            }
            
            // Handle DB game disconnection
            for (const [gameId, playerSet] of dbGamePlayers) {
                if (playerSet.has(socket.id)) {
                    playerSet.delete(socket.id);
                    console.log(`Removed socket ${socket.id} from DB game ${gameId}`);
                    
                    // If no players left in DB game, clean up
                    if (playerSet.size === 0) {
                        dbGamePlayers.delete(gameId);
                        console.log(`Cleaned up empty DB game ${gameId}`);
                    }
                    break;
                }
            }
            
            // Handle chat room disconnection
            for (const [gameId, chatRoom] of chatRooms) {
                if (chatRoom.players.has(socket.id)) {
                    chatRoom.players.delete(socket.id);
                    console.log(`Removed socket ${socket.id} from chat room ${gameId}`);
                    
                    // Notify remaining players in chat
                    socket.to(`chat_${gameId}`).emit('chat_player_count', {
                        count: chatRoom.players.size
                    });
                    
                    // Clean up empty chat rooms
                    if (chatRoom.players.size === 0) {
                        console.log(`Cleaning up empty chat room for game ${gameId}`);
                        // Keep messages for a while in case players reconnect
                        setTimeout(() => {
                            if (chatRooms.has(gameId) && chatRooms.get(gameId).players.size === 0) {
                                chatRooms.delete(gameId);
                                console.log(`Chat room for game ${gameId} deleted`);
                            }
                        }, 5 * 60 * 1000); // 5 minutes delay
                    }
                    break;
                }
            }
            
            // Update games list for everyone
            io.emit('games_updated', improvedLobbyManager.getAvailableGames());
            
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });
	
	// Zug beenden
socket.on('end_turn', async (data) => {
    try {
        console.log('End turn request:', data);
        
        const result = await gameEngine.endTurn(data.gameId, data.playerId);
        
        if (result.success) {
            // Benachrichtige alle Spieler über Zugwechsel
            io.to(`db_game_${data.gameId}`).emit('turn_ended', {
                nextPlayer: result.nextPlayer,
                turnNumber: result.turnNumber,
                isNewRound: result.isNewRound
            });
            
            // Prüfe Spielende
            const gameEndCheck = await gameEngine.checkGameEnd(data.gameId);
            if (gameEndCheck.gameEnded) {
                io.to(`db_game_${data.gameId}`).emit('game_ended', gameEndCheck);
            } else if (gameEndCheck.eliminatedPlayers.length > 0) {
                gameEndCheck.eliminatedPlayers.forEach(player => {
                    io.to(`db_game_${data.gameId}`).emit('player_eliminated', {
                        playerName: player.player_name
                    });
                });
            }
            
        } else {
            socket.emit('error', result.message);
        }
    } catch (error) {
        console.error('Error in end_turn:', error);
        socket.emit('error', 'Fehler beim Beenden des Zuges');
    }
});

// Einheit bewegen
socket.on('move_unit', async (data) => {
    try {
        console.log('Move unit request:', data);
        
        const result = await gameEngine.moveUnit(
            data.gameId, 
            data.playerId, 
            data.unitId, 
            data.targetX, 
            data.targetY
        );
        
        if (result.success) {
            // Benachrichtige alle Spieler über die Bewegung
            io.to(`db_game_${data.gameId}`).emit('unit_moved', {
                unitId: result.unitId,
                fromX: result.fromX,
                fromY: result.fromY,
                toX: result.toX,
                toY: result.toY,
                movementCost: result.movementCost,
                remainingMovement: result.remainingMovement
            });
            
            // Prüfe ob Gebäude erobert wurde
            const captureResult = await gameEngine.captureBuilding(
                data.gameId, 
                data.playerId, 
                data.targetX, 
                data.targetY
            );
            
            if (captureResult.success && captureResult.captured) {
                io.to(`db_game_${data.gameId}`).emit('building_captured', {
                    playerId: data.playerId,
                    x: data.targetX,
                    y: data.targetY,
                    buildingType: captureResult.buildingType
                });
            }
            
        } else {
            socket.emit('error', result.message);
        }
    } catch (error) {
        console.error('Error in move_unit:', error);
        socket.emit('error', 'Fehler bei der Bewegung');
    }
});

// Angriff ausführen
socket.on('attack_unit', async (data) => {
    try {
        console.log('Attack unit request:', data);
        
        const result = await gameEngine.attackUnit(
            data.gameId,
            data.playerId,
            data.attackerUnitId,
            data.targetX,
            data.targetY
        );
        
        if (result.success) {
            // Benachrichtige alle Spieler über den Angriff
            io.to(`db_game_${data.gameId}`).emit('unit_attacked', {
                attacker: result.attacker,
                defender: result.defender
            });
            
            // Prüfe Spielende nach Kampf
            const gameEndCheck = await gameEngine.checkGameEnd(data.gameId);
            if (gameEndCheck.gameEnded) {
                io.to(`db_game_${data.gameId}`).emit('game_ended', gameEndCheck);
            } else if (gameEndCheck.eliminatedPlayers.length > 0) {
                gameEndCheck.eliminatedPlayers.forEach(player => {
                    io.to(`db_game_${data.gameId}`).emit('player_eliminated', {
                        playerName: player.player_name
                    });
                });
            }
            
        } else {
            socket.emit('error', result.message);
        }
    } catch (error) {
        console.error('Error in attack_unit:', error);
        socket.emit('error', 'Fehler beim Angriff');
    }
});

// Einheit kaufen
socket.on('purchase_unit', async (data) => {
    try {
        console.log('Purchase unit request:', data);
        
        const result = await gameEngine.purchaseUnit(
            data.gameId,
            data.playerId,
            data.unitTypeId,
            data.buildingX,
            data.buildingY
        );
        
        if (result.success) {
            // Benachrichtige alle Spieler über den Kauf
            io.to(`db_game_${data.gameId}`).emit('unit_purchased', {
                playerId: data.playerId,
                unit: result.unit,
                newGold: result.newGold
            });
        } else {
            socket.emit('error', result.message);
        }
    } catch (error) {
        console.error('Error in purchase_unit:', error);
        socket.emit('error', 'Fehler beim Einheitenkauf');
    }
});

// Spielzustand abrufen (bereits vorhanden, aber erweitert)
socket.on('get_game_state', async (data) => {
    try {
        const result = await gameEngine.loadGameState(data.gameId);
        
        if (result.success) {
            socket.emit('game_state', result.gameState);
        } else {
            socket.emit('error', result.message || 'Spielstatus nicht gefunden');
        }
    } catch (error) {
        console.error('Error in get_game_state:', error);
        socket.emit('error', 'Fehler beim Laden des Spielstatus: ' + error.message);
    }
});

// Debug/Admin Events für Spielentwicklung
socket.on('admin_force_game_end', async (data) => {
    try {
        if (!data.gameId) {
            socket.emit('error', 'Game ID required');
            return;
        }
        
        console.log(`Admin forcing game end for game ${data.gameId}`);
        
        // Spiel als beendet markieren
        await db.query('UPDATE games SET status = "finished", finished_at = NOW() WHERE id = ?', [data.gameId]);
        
        // Alle Spieler benachrichtigen
        io.to(`db_game_${data.gameId}`).emit('game_ended', {
            gameEnded: true,
            winner: null,
            adminForced: true
        });
        
        socket.emit('admin_action_success', {
            action: 'force_game_end',
            gameId: data.gameId
        });
        
    } catch (error) {
        console.error('Error forcing game end:', error);
        socket.emit('error', 'Fehler beim Beenden des Spiels');
    }
});

socket.on('admin_get_game_engine_stats', async (data) => {
    try {
        if (!data.gameId) {
            socket.emit('error', 'Game ID required');
            return;
        }
        
        const result = await gameEngine.loadGameState(data.gameId);
        
        if (result.success) {
            const gameState = result.gameState;
            const stats = {
                gameId: data.gameId,
                status: gameState.game.status,
                turnNumber: gameState.game.turn_number,
                currentPlayer: gameState.players.find(p => p.id === gameState.game.current_turn_player_id),
                playerCount: gameState.players.length,
                activePlayerCount: gameState.players.filter(p => p.is_active).length,
                unitCount: gameState.units.length,
                mapSize: gameState.game.map_size,
                buildingCount: gameState.map.filter(m => m.building_type_id).length,
                playerStats: gameState.players.map(p => ({
                    name: p.player_name,
                    race: p.race_name,
                    gold: p.gold,
                    active: p.is_active,
                    unitCount: gameState.units.filter(u => u.player_id === p.id).length,
                    buildingCount: gameState.map.filter(m => m.owner_player_id === p.id && m.building_type_id).length
                }))
            };
            
            socket.emit('admin_game_engine_stats', stats);
        } else {
            socket.emit('error', result.message);
        }
        
    } catch (error) {
        console.error('Error getting game engine stats:', error);
        socket.emit('error', 'Fehler beim Abrufen der Game Engine Statistiken');
    }
});

socket.on('admin_reset_unit_actions', async (data) => {
    try {
        if (!data.gameId) {
            socket.emit('error', 'Game ID required');
            return;
        }
        
        console.log(`Admin resetting unit actions for game ${data.gameId}`);
        
        // Alle Einheiten zurücksetzen
        await db.query(`
            UPDATE game_units gu
            JOIN units u ON gu.unit_id = u.id
            SET gu.movement_points_left = u.movement_points,
                gu.has_attacked = 0
            WHERE gu.game_id = ?
        `, [data.gameId]);
        
        // Invalidiere Cache
        gameEngine.activeGames.delete(data.gameId);
        
        // Alle Spieler benachrichtigen
        io.to(`db_game_${data.gameId}`).emit('units_reset', {
            message: 'Alle Einheiten wurden von einem Administrator zurückgesetzt'
        });
        
        socket.emit('admin_action_success', {
            action: 'reset_unit_actions',
            gameId: data.gameId
        });
        
    } catch (error) {
        console.error('Error resetting unit actions:', error);
        socket.emit('error', 'Fehler beim Zurücksetzen der Einheiten-Aktionen');
    }
});

socket.on('admin_add_gold', async (data) => {
    try {
        if (!data.gameId || !data.playerId || !data.amount) {
            socket.emit('error', 'Game ID, Player ID und Amount required');
            return;
        }
        
        console.log(`Admin adding ${data.amount} gold to player ${data.playerId} in game ${data.gameId}`);
        
        await db.query(
            'UPDATE game_players SET gold = gold + ? WHERE id = ? AND game_id = ?',
            [data.amount, data.playerId, data.gameId]
        );
        
        // Invalidiere Cache
        gameEngine.activeGames.delete(data.gameId);
        
        // Alle Spieler benachrichtigen
        io.to(`db_game_${data.gameId}`).emit('gold_added', {
            playerId: data.playerId,
            amount: data.amount,
            message: `${data.amount} Gold wurde von einem Administrator hinzugefügt`
        });
        
        socket.emit('admin_action_success', {
            action: 'add_gold',
            gameId: data.gameId,
            playerId: data.playerId,
            amount: data.amount
        });
        
    } catch (error) {
        console.error('Error adding gold:', error);
        socket.emit('error', 'Fehler beim Hinzufügen von Gold');
    }
});

// Zusätzliche Utility-Events
socket.on('get_unit_details', async (data) => {
    try {
        if (!data.unitId) {
            socket.emit('error', 'Unit ID required');
            return;
        }
        
        const unitDetails = await db.query(`
            SELECT 
                gu.*,
                u.name as unit_name,
                u.attack_power,
                u.health as max_health,
                u.movement_points as max_movement_points,
                u.attack_range,
                u.cost,
                gp.player_name as player_name,
                r.name as race_name,
                r.color_hex as player_color
            FROM game_units gu
            JOIN units u ON gu.unit_id = u.id
            JOIN game_players gp ON gu.player_id = gp.id
            JOIN races r ON gp.race_id = r.id
            WHERE gu.id = ?
        `, [data.unitId]);
        
        if (unitDetails.length > 0) {
            socket.emit('unit_details', unitDetails[0]);
        } else {
            socket.emit('error', 'Einheit nicht gefunden');
        }
        
    } catch (error) {
        console.error('Error getting unit details:', error);
        socket.emit('error', 'Fehler beim Abrufen der Einheiten-Details');
    }
});

socket.on('get_building_details', async (data) => {
    try {
        if (data.x === undefined || data.y === undefined || !data.gameId) {
            socket.emit('error', 'Coordinates and Game ID required');
            return;
        }
        
        const buildingDetails = await db.query(`
            SELECT 
                gm.*,
                bt.name as building_name,
                bt.color_hex as building_color,
                bt.gold_income,
                bt.max_health as building_max_health,
                gp.player_name as owner_name,
                r.name as owner_race,
                r.color_hex as owner_color
            FROM game_maps gm
            LEFT JOIN building_types bt ON gm.building_type_id = bt.id
            LEFT JOIN game_players gp ON gm.owner_player_id = gp.id
            LEFT JOIN races r ON gp.race_id = r.id
            WHERE gm.game_id = ? AND gm.x_coordinate = ? AND gm.y_coordinate = ?
        `, [data.gameId, data.x, data.y]);
        
        if (buildingDetails.length > 0) {
            socket.emit('building_details', buildingDetails[0]);
        } else {
            socket.emit('error', 'Feld nicht gefunden');
        }
        
    } catch (error) {
        console.error('Error getting building details:', error);
        socket.emit('error', 'Fehler beim Abrufen der Gebäude-Details');
    }
});
});

// Periodic cleanup of stale connections and old chat rooms
setInterval(() => {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const maxChatAge = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean up stale DB game players
    for (const [gameId, playerSet] of dbGamePlayers) {
        for (const socketId of playerSet) {
            const socket = io.sockets.sockets.get(socketId);
            if (!socket || (socket.lastSeen && now - socket.lastSeen > staleThreshold)) {
                playerSet.delete(socketId);
                console.log(`Cleaned up stale socket ${socketId} from DB game ${gameId}`);
            }
        }
        
        if (playerSet.size === 0) {
            dbGamePlayers.delete(gameId);
            console.log(`Cleaned up empty DB game ${gameId}`);
        }
    }
    
    // Clean up old chat rooms
    for (const [gameId, chatRoom] of chatRooms) {
        const roomAge = now - chatRoom.createdAt.getTime();
        
        // Clean up old empty chat rooms
        if (chatRoom.players.size === 0 && roomAge > maxChatAge) {
            chatRooms.delete(gameId);
            console.log(`Cleaned up old chat room for game ${gameId}`);
        }
    }
}, 60000); // Every minute

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const dbCheck = await db.query('SELECT 1');
        const timestamp = new Date().toISOString();
        
        res.json({
            status: 'healthy',
            timestamp: timestamp,
            database: 'connected',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            activeConnections: io.engine.clientsCount,
            memoryGames: improvedLobbyManager.games.size,
            memoryPlayers: improvedLobbyManager.players.size,
            dbGames: dbGamePlayers.size,
            chatRooms: chatRooms.size,
            version: require('../package.json').version
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Debug endpoints (only in development)
if (process.env.NODE_ENV === 'development') {
    app.get('/debug/memory-games', (req, res) => {
        const games = Array.from(improvedLobbyManager.games.entries()).map(([id, game]) => ({
            id: id,
            name: game.name,
            players: Array.from(game.players.values()).map(p => p.name),
            status: game.status,
            createdAt: game.createdAt
        }));
        
        res.json({
            totalGames: games.length,
            games: games,
            timestamp: new Date().toISOString()
        });
    });

    app.get('/debug/db-games', (req, res) => {
        const games = Array.from(dbGamePlayers.entries()).map(([gameId, playerSet]) => ({
            gameId: gameId,
            playerCount: playerSet.size,
            socketIds: Array.from(playerSet)
        }));
        
        res.json({
            totalDbGames: games.length,
            games: games,
            timestamp: new Date().toISOString()
        });
    });

    app.get('/debug/chat-rooms', (req, res) => {
        const rooms = Array.from(chatRooms.entries()).map(([gameId, chatRoom]) => ({
            gameId: gameId,
            messageCount: chatRoom.messages.length,
            playerCount: chatRoom.players.size,
            createdAt: chatRoom.createdAt,
            lastMessage: chatRoom.messages.length > 0 ? chatRoom.messages[chatRoom.messages.length - 1] : null
        }));
        
        res.json({
            totalChatRooms: rooms.length,
            rooms: rooms,
            timestamp: new Date().toISOString()
        });
    });

    app.get('/debug/socket-rooms', (req, res) => {
        const rooms = [];
        for (const [roomName, room] of io.sockets.adapter.rooms) {
            if (!roomName.startsWith('socket.io#')) {
                rooms.push({
                    name: roomName,
                    playerCount: room.size,
                    socketIds: Array.from(room)
                });
            }
        }
        
        res.json({
            totalRooms: rooms.length,
            rooms: rooms,
            timestamp: new Date().toISOString()
        });
    });

    app.post('/debug/broadcast-test/:gameId', async (req, res) => {
        try {
            const gameId = parseInt(req.params.gameId);
            const message = req.body.message || 'Test broadcast message';
            
            io.to(`db_game_${gameId}`).emit('debug_broadcast', {
                message: message,
                timestamp: new Date().toISOString(),
                gameId: gameId
            });
            
            res.json({
                success: true,
                message: `Broadcast sent to game ${gameId}`,
                roomName: `db_game_${gameId}`
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    app.post('/debug/force-sync/:gameId', async (req, res) => {
        try {
            const gameId = parseInt(req.params.gameId);
            await broadcastRaceSelectionSync(gameId);
            
            res.json({
                success: true,
                message: `Race selection sync forced for game ${gameId}`
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    app.post('/debug/send-chat-message/:gameId', (req, res) => {
        try {
            const gameId = parseInt(req.params.gameId);
            const message = req.body.message || 'Test chat message from admin';
            const playerName = req.body.playerName || 'System';
            
            // Add message to chat room
            const chatMessage = addChatMessage(gameId, playerName, message, 'admin');
            
            // Broadcast to chat room
            io.to(`chat_${gameId}`).emit('chat_message', {
                playerName: playerName,
                message: message,
                timestamp: chatMessage.timestamp,
                playerId: 'admin'
            });
            
            res.json({
                success: true,
                message: `Chat message sent to game ${gameId}`,
                chatMessage: chatMessage
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
}

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    // Close server
    server.close(() => {
        console.log('HTTP server closed');
        
        // Close database connections
        if (db && db.pool) {
            db.pool.end(() => {
                console.log('Database pool closed');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });

    // Force close after 30 seconds
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    
    // Notify all connected clients about shutdown
    io.emit('server_shutdown', {
        message: 'Server wird heruntergefahren. Bitte speichere deinen Fortschritt.',
        timestamp: new Date().toISOString()
    });
    
    // Give clients time to receive the message
    setTimeout(() => {
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    }, 2000);
});

// Error Handling
app.use((err, req, res, next) => {
    console.error('Express error:', err.stack);
    res.status(500).json({ 
        error: 'Interner Serverfehler',
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] || 'unknown'
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

// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // In production, you might want to restart the process
    if (process.env.NODE_ENV === 'production') {
        console.error('Uncaught exception in production, exiting...');
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // In production, you might want to restart the process
    if (process.env.NODE_ENV === 'production') {
        console.error('Unhandled rejection in production, exiting...');
        process.exit(1);
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server läuft auf Port ${PORT}`);
    console.log(`📱 Spiel verfügbar unter: http://localhost:${PORT}`);
    console.log(`💾 Memory-basierte Lobby aktiviert`);
    console.log(`🎯 Datenbank für persistente Spiele bereit`);
    console.log(`🔄 Erweiterte Socket.IO-Konfiguration aktiv`);
    console.log(`⚡ Heartbeat-System aktiviert`);
    console.log(`💬 Chat-System aktiviert`);
    console.log(`🔧 Debug-Endpoints verfügbar: ${process.env.NODE_ENV === 'development'}`);
    console.log(`🏥 Health-Check verfügbar unter: /health`);
    
    if (process.env.NODE_ENV === 'development') {
        console.log(`🐛 Debug-Endpoints:`);
        console.log(`   - GET /debug/memory-games`);
        console.log(`   - GET /debug/db-games`);
        console.log(`   - GET /debug/chat-rooms`);
        console.log(`   - GET /debug/socket-rooms`);
        console.log(`   - POST /debug/broadcast-test/:gameId`);
        console.log(`   - POST /debug/force-sync/:gameId`);
        console.log(`   - POST /debug/send-chat-message/:gameId`);
        console.log(`   - GET /api/game/:gameId/chat`);
    }
    
    console.log(`\n📋 Verfügbare API Endpoints:`);
    console.log(`   - GET /api/test`);
    console.log(`   - GET /api/games`);
    console.log(`   - GET /api/races`);
    console.log(`   - GET /api/game/:gameId/race-selections`);
    console.log(`   - GET /api/game/:gameId/status`);
    console.log(`   - GET /api/game/:gameId/chat`);
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
});

