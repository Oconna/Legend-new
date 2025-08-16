const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import controllers
const lobbyController = require('./controllers/lobbyController');
const gameController = require('./controllers/gameController');

// Import database
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
        // Test database connection
        const testResult = await db.query('SELECT 1 as test');
        
        // Test races table
        const races = await db.query('SELECT COUNT(*) as count FROM races');
        
        // Test games table structure
        const gamesStructure = await db.query('DESCRIBE games');
        
        // Test game_players table structure  
        const playersStructure = await db.query('DESCRIBE game_players');
        
        res.json({
            status: 'OK',
            database: 'Connected',
            testQuery: testResult,
            racesCount: races[0].count,
            gamesTableStructure: gamesStructure,
            playersTableStructure: playersStructure,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('API Test Error:', error);
        res.status(500).json({
            status: 'ERROR',
            error: error.message,
            stack: error.stack
        });
    }
});

app.get('/api/test-lobby', async (req, res) => {
    try {
        // Test create game function
        const createResult = await lobbyController.createGame(
            'Test Game', 4, 30, 'Test Player', 'test-socket-id'
        );
        
        res.json({
            status: 'OK',
            createGameTest: createResult,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Lobby Test Error:', error);
        res.status(500).json({
            status: 'ERROR',
            error: error.message,
            stack: error.stack
        });
    }
});

app.get('/api/games', async (req, res) => {
    try {
        const games = await lobbyController.getAvailableGames();
        res.json(games);
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

// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log(`Neuer Spieler verbunden: ${socket.id}`);

    // Lobby Events
    socket.on('create_game', async (data) => {
        try {
            console.log('Create game request:', data);
            const result = await lobbyController.createGame(data.gameName, data.maxPlayers, data.mapSize, data.playerName, socket.id);
            console.log('Create game result:', result);
            
            if (result.success) {
                socket.join(result.gameId);
                socket.emit('game_created', result);
                
                // Send current lobby state
                const players = await lobbyController.getGamePlayers(result.gameId);
                io.to(result.gameId).emit('lobby_players_updated', players);
                
                io.emit('games_updated', await lobbyController.getAvailableGames());
            } else {
                console.error('Game creation failed:', result.message);
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in create_game:', error);
            socket.emit('error', 'Fehler beim Erstellen des Spiels: ' + error.message);
        }
    });

    socket.on('join_game', async (data) => {
        try {
            console.log('Join game request:', data);
            const result = await lobbyController.joinGame(data.gameId, data.playerName, socket.id);
            console.log('Join game result:', result);
            
            if (result.success) {
                socket.join(data.gameId);
                socket.emit('game_joined', result);
                
                // Notify other players
                socket.to(data.gameId).emit('player_joined', {
                    playerName: data.playerName,
                    currentPlayers: result.currentPlayers
                });
                
                // Send updated player list to all players in lobby
                const players = await lobbyController.getGamePlayers(data.gameId);
                io.to(data.gameId).emit('lobby_players_updated', players);
                
                io.emit('games_updated', await lobbyController.getAvailableGames());
            } else {
                console.error('Game join failed:', result.message);
                socket.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in join_game:', error);
            socket.emit('error', 'Fehler beim Beitreten des Spiels: ' + error.message);
        }
    });

    socket.on('player_ready', async (data) => {
        try {
            const result = await lobbyController.setPlayerReady(data.gameId, data.playerName, data.ready);
            if (result.success) {
                // Send updated player list to all players in lobby
                const players = await lobbyController.getGamePlayers(data.gameId);
                io.to(data.gameId).emit('lobby_players_updated', players);
                
                io.to(data.gameId).emit('player_ready_status', {
                    playerName: data.playerName,
                    ready: data.ready,
                    allReady: result.allReady,
                    readyCount: result.readyCount,
                    totalPlayers: result.totalPlayers
                });
            }
        } catch (error) {
            socket.emit('error', 'Fehler bei der Bereitschaftsanzeige');
        }
    });

    socket.on('start_game', async (data) => {
        try {
            const result = await lobbyController.startGame(data.gameId, data.playerName);
            if (result.success) {
                // Starte Rassenwahl Phase
                await gameController.startRaceSelection(data.gameId);
                io.to(data.gameId).emit('start_race_selection', {
                    message: 'Spiel gestartet! Rassenwahl beginnt...'
                });
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            socket.emit('error', 'Fehler beim Starten des Spiels');
        }
    });

    socket.on('leave_game', async (data) => {
        try {
            const result = await lobbyController.leaveGame(data.gameId, data.playerName);
            if (result.success) {
                socket.leave(data.gameId);
                socket.emit('game_left', result);
                
                if (result.gameDeleted) {
                    // Benachrichtige alle über gelöschtes Spiel
                    io.emit('games_updated', await lobbyController.getAvailableGames());
                } else {
                    // Benachrichtige andere Spieler in der Lobby
                    socket.to(data.gameId).emit('player_left', {
                        playerName: data.playerName,
                        remainingPlayers: result.remainingPlayers
                    });
                    
                    // Send updated player list to remaining players
                    const players = await lobbyController.getGamePlayers(data.gameId);
                    io.to(data.gameId).emit('lobby_players_updated', players);
                    
                    // Update games list
                    io.emit('games_updated', await lobbyController.getAvailableGames());
                }
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            socket.emit('error', 'Fehler beim Verlassen des Spiels');
        }
    });

    // Game Events
    socket.on('select_race', async (data) => {
        try {
            const result = await gameController.selectRace(data.gameId, data.playerName, data.raceId);
            if (result.success) {
                io.to(data.gameId).emit('race_selected', {
                    playerName: data.playerName,
                    raceId: data.raceId,
                    raceName: result.raceName
                });

                if (result.allRacesSelected) {
                    // Starte Kartengenerierung und Spiel
                    const gameStartResult = await gameController.startGame(data.gameId);
                    if (gameStartResult.success) {
                        io.to(data.gameId).emit('game_started', {
                            message: 'Spiel startet! Karte wird generiert...',
                            gameData: gameStartResult.gameData
                        });
                    }
                }
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            socket.emit('error', 'Fehler bei der Rassenwahl');
        }
    });

    socket.on('get_game_state', async (data) => {
        try {
            const gameState = await gameController.getGameState(data.gameId);
            socket.emit('game_state', gameState);
        } catch (error) {
            socket.emit('error', 'Fehler beim Laden des Spielstatus');
        }
    });

    // Disconnect
    socket.on('disconnect', async () => {
        console.log(`Spieler getrennt: ${socket.id}`);
        
        // Finde Spieler anhand der Socket-ID und entferne ihn aus allen Spielen
        try {
            const playerGames = await db.query(
                'SELECT game_id, player_name FROM game_players WHERE socket_id = ? AND is_active = true',
                [socket.id]
            );

            for (const playerGame of playerGames) {
                const result = await lobbyController.leaveGame(playerGame.game_id, playerGame.player_name);
                if (result.success) {
                    if (result.gameDeleted) {
                        io.emit('games_updated', await lobbyController.getAvailableGames());
                    } else {
                        // Benachrichtige andere Spieler
                        socket.to(playerGame.game_id).emit('player_left', {
                            playerName: playerGame.player_name,
                            remainingPlayers: result.remainingPlayers
                        });
                        
                        // Send updated player list
                        const players = await lobbyController.getGamePlayers(playerGame.game_id);
                        io.to(playerGame.game_id).emit('lobby_players_updated', players);
                        
                        io.emit('games_updated', await lobbyController.getAvailableGames());
                    }
                }
            }
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
});