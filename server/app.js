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
app.get('/api/games', async (req, res) => {
    try {
        const games = await lobbyController.getAvailableGames();
        res.json(games);
    } catch (error) {
        res.status(500).json({ error: 'Fehler beim Laden der Spiele' });
    }
});

app.get('/api/races', async (req, res) => {
    try {
        const races = await db.query('SELECT * FROM races ORDER BY name');
        res.json(races);
    } catch (error) {
        res.status(500).json({ error: 'Fehler beim Laden der Rassen' });
    }
});

// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log(`Neuer Spieler verbunden: ${socket.id}`);

    // Lobby Events
    socket.on('create_game', async (data) => {
        try {
            const result = await lobbyController.createGame(data.gameName, data.maxPlayers, data.mapSize, data.playerName, socket.id);
            if (result.success) {
                socket.join(result.gameId);
                socket.emit('game_created', result);
                
                // Send current lobby state
                const players = await lobbyController.getGamePlayers(result.gameId);
                io.to(result.gameId).emit('lobby_players_updated', players);
                
                io.emit('games_updated', await lobbyController.getAvailableGames());
            } else {
                socket.emit('error', result.message);
            }
        } catch (error) {
            socket.emit('error', 'Fehler beim Erstellen des Spiels');
        }
    });

    socket.on('join_game', async (data) => {
        try {
            const result = await lobbyController.joinGame(data.gameId, data.playerName, socket.id);
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
                socket.emit('error', result.message);
            }
        } catch (error) {
            socket.emit('error', 'Fehler beim Beitreten des Spiels');
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
    socket.on('disconnect', () => {
        console.log(`Spieler getrennt: ${socket.id}`);
        // TODO: Handle player disconnect (remove from games, etc.)
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