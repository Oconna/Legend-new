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
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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

// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log(`Neuer Spieler verbunden: ${socket.id}`);

    // Send initial games list and setup periodic updates
    socket.emit('games_updated', improvedLobbyManager.getAvailableGames());
    
    // Send game list updates every 5 seconds to ensure sync
    const gameListInterval = setInterval(() => {
        socket.emit('games_updated', improvedLobbyManager.getAvailableGames());
    }, 5000);

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
                        
                        for (const [socketId, player] of memoryGame.players) {
                            const playerSocket = io.sockets.sockets.get(socketId);
                            if (playerSocket) {
                                playerSocket.join(`db_game_${result.dbGameId}`);
                                playerSocket.leave(`game_${playerData.gameId}`);
                                
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
                    // Race was confirmed
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
                    // Race was only selected (not confirmed)
                    // Notify all players about selection
                    io.to(`db_game_${data.gameId}`).emit('player_race_selected', {
                        playerName: result.playerName,
                        raceId: result.raceId,
                        raceName: result.raceName,
                        selectedCount: result.racesSelected,
                        totalPlayers: result.totalPlayers
                    });
                }

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

    // New event for deselecting/changing races
    socket.on('deselect_race', async (data) => {
        try {
            console.log('Race deselection request:', data);
            
            if (!data.gameId || !data.playerName) {
                socket.emit('error', 'Unvollständige Daten für Rassenabwahl');
                return;
            }
            
            // Reset player's race selection in database
            const result = await gameController.deselectRace(data.gameId, data.playerName);
            
            if (result.success) {
                console.log(`✓ Race deselected by ${data.playerName} in game ${data.gameId}`);
                
                // Notify all players about deselection
                io.to(`db_game_${data.gameId}`).emit('player_race_deselected', {
                    playerName: data.playerName
                });
                
                socket.emit('race_deselection_confirmed', {
                    message: 'Rassenauswahl zurückgesetzt'
                });
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

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`Spieler getrennt: ${socket.id}`);
        
        // Clear interval
        if (gameListInterval) {
            clearInterval(gameListInterval);
        }
        
        try {
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
            
            // Update games list for everyone
            io.emit('games_updated', improvedLobbyManager.getAvailableGames());
            
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });
});

// Error Handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Interner Serverfehler' });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server läuft auf Port ${PORT}`);
    console.log(`📱 Spiel verfügbar unter: http://localhost:${PORT}`);
    console.log(`💾 Memory-basierte Lobby aktiviert`);
    console.log(`🎯 Datenbank für persistente Spiele bereit`);
});