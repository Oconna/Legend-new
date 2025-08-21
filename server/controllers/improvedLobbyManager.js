class ImprovedLobbyManager {
    constructor() {
        // In-Memory Game Storage
        this.games = new Map(); // gameId -> gameData
        this.players = new Map(); // socketId -> playerData
        this.gameIdCounter = 1;
    }

    // Create game in memory only
    createGame(socketId, playerName, gameName, maxPlayers, mapSize) {
        try {
            // Validation
            if (!gameName || gameName.trim().length === 0) {
                return { success: false, message: 'Spielname erforderlich' };
            }
            
            if (!playerName || playerName.trim().length === 0) {
                return { success: false, message: 'Spielername erforderlich' };
            }
            
            if (maxPlayers < 2 || maxPlayers > 8) {
                return { success: false, message: 'Spieleranzahl muss zwischen 2 und 8 liegen' };
            }

            if (![20, 30, 50, 100].includes(mapSize)) {
                return { success: false, message: 'Ungültige Kartengröße' };
            }

            // Check if game name already exists
            for (const [gameId, game] of this.games) {
                if (game.name === gameName.trim()) {
                    return { success: false, message: 'Spielname bereits vergeben' };
                }
            }

            const gameId = this.gameIdCounter++;
            
            // Create game object
            const gameData = {
                id: gameId,
                name: gameName.trim(),
                maxPlayers: maxPlayers,
                mapSize: mapSize,
                status: 'waiting', // waiting, race_selection, playing, finished
                players: new Map(), // socketId -> playerData
                hostSocketId: socketId,
                createdAt: new Date()
            };

            // Add host player
            const hostPlayer = {
                socketId: socketId,
                name: playerName.trim(),
                isHost: true,
                isReady: false,
                raceId: null,
                joinedAt: new Date()
            };

            gameData.players.set(socketId, hostPlayer);
            this.games.set(gameId, gameData);
            this.players.set(socketId, { gameId: gameId, ...hostPlayer });

            console.log(`Game created: ${gameName} (ID: ${gameId}) by ${playerName}`);

            return {
                success: true,
                gameId: gameId,
                gameName: gameName.trim(),
                maxPlayers: maxPlayers,
                mapSize: mapSize,
                isHost: true,
                players: this.getGamePlayersArray(gameId)
            };

        } catch (error) {
            console.error('Error creating game:', error);
            return { success: false, message: 'Fehler beim Erstellen des Spiels' };
        }
    }

    // Join game in memory
joinGame(socketId, playerName, gameId) {
    try {
        const game = this.games.get(gameId);
        
        if (!game) {
            return { success: false, message: 'Spiel nicht gefunden' };
        }

        if (game.status !== 'waiting') {
            return { success: false, message: 'Spiel bereits gestartet' };
        }

        if (game.players.size >= game.maxPlayers) {
            return { success: false, message: 'Spiel ist bereits voll' };
        }

        // Check if player name already exists in this game
        for (const [existingSocketId, player] of game.players) {
            if (player.name === playerName.trim()) {
                return { success: false, message: 'Spielername bereits vergeben' };
            }
        }

        // Add player to game
        const playerData = {
            socketId: socketId,
            name: playerName.trim(),
            isHost: false,
            isReady: false,
            raceId: null,
            joinedAt: new Date()
        };

        game.players.set(socketId, playerData);
        this.players.set(socketId, { gameId: gameId, ...playerData });

        console.log(`Player ${playerName} joined game ${game.name} (ID: ${gameId})`);

        const playersArray = this.getGamePlayersArray(gameId);

        return {
            success: true,
            gameId: gameId,
            gameName: game.name,
            maxPlayers: game.maxPlayers,
            mapSize: game.mapSize,
            isHost: false,
            players: playersArray,
            currentPlayers: playersArray.length // WICHTIG: Für Client
        };

    } catch (error) {
        console.error('Error joining game:', error);
        return { success: false, message: 'Fehler beim Beitreten des Spiels' };
    }
}

getGameInfo(gameId) {
    try {
        const game = this.games.get(gameId);
        if (!game) {
            return null;
        }
        
        const playersArray = this.getGamePlayersArray(gameId);
        
        return {
            gameId: gameId,
            gameName: game.name,
            maxPlayers: game.maxPlayers,
            currentPlayers: playersArray.length,
            mapSize: game.mapSize,
            status: game.status,
            players: playersArray
        };
    } catch (error) {
        console.error('Error getting game info:', error);
        return null;
    }
}

    // Set player ready status
setPlayerReady(socketId, ready) {
    try {
        const playerData = this.players.get(socketId);
        if (!playerData) {
            return { success: false, message: 'Spieler nicht gefunden' };
        }

        const game = this.games.get(playerData.gameId);
        if (!game) {
            return { success: false, message: 'Spiel nicht gefunden' };
        }

        // Update ready status
        const gamePlayer = game.players.get(socketId);
        if (gamePlayer) {
            gamePlayer.isReady = ready;
            playerData.isReady = ready;
        }

        // Check if all players are ready
        const playersArray = Array.from(game.players.values());
        const allReady = playersArray.length >= 2 && playersArray.every(p => p.isReady);
        const readyCount = playersArray.filter(p => p.isReady).length;
        
        // Check if game can start (all ready + host can start)
        const canStart = allReady && playersArray.length >= 2;

        console.log(`Player ${gamePlayer.name} is ${ready ? 'ready' : 'not ready'} in game ${game.name}`);

        return {
            success: true,
            allReady: allReady,
            canStart: canStart,
            readyCount: readyCount,
            totalPlayers: playersArray.length,
            players: this.getGamePlayersArray(playerData.gameId)
        };

    } catch (error) {
        console.error('Error setting player ready:', error);
        return { success: false, message: 'Fehler bei der Bereitschaftsanzeige' };
    }
}

    // Leave game
leaveGame(socketId) {
    try {
        const playerData = this.players.get(socketId);
        if (!playerData) {
            return { success: false, message: 'Spieler nicht in einem Spiel' };
        }

        const game = this.games.get(playerData.gameId);
        if (!game) {
            return { success: false, message: 'Spiel nicht gefunden' };
        }

        const isHost = playerData.isHost;
        const playerName = playerData.name;
        const gameId = playerData.gameId;
        
        // Remove player from game
        game.players.delete(socketId);
        this.players.delete(socketId);

        console.log(`Player ${playerName} left game ${game.name}`);

        // If no players left, delete game
        if (game.players.size === 0) {
            this.games.delete(gameId);
            console.log(`Game ${game.name} deleted (no players left)`);
            return {
                success: true,
                gameDeleted: true,
                gameId: gameId,
                message: 'Spiel verlassen und gelöscht'
            };
        }

        // If host left, assign new host
        if (isHost && game.players.size > 0) {
            const newHost = Array.from(game.players.values())[0];
            newHost.isHost = true;
            game.hostSocketId = newHost.socketId;
            this.players.get(newHost.socketId).isHost = true;
            console.log(`New host assigned: ${newHost.name}`);
        }

        const playersArray = this.getGamePlayersArray(gameId);
        
        return {
            success: true,
            gameDeleted: false,
            gameId: gameId,
            remainingPlayers: game.players.size,
            players: playersArray,
            maxPlayers: game.maxPlayers // WICHTIG: MaxPlayers für Client
        };

    } catch (error) {
        console.error('Error leaving game:', error);
        return { success: false, message: 'Fehler beim Verlassen des Spiels' };
    }
}

    // Start game - THIS is when we write to database
    async startGame(socketId, db) {
        try {
            const playerData = this.players.get(socketId);
            if (!playerData || !playerData.isHost) {
                return { success: false, message: 'Nur der Host kann das Spiel starten' };
            }

            const game = this.games.get(playerData.gameId);
            if (!game) {
                return { success: false, message: 'Spiel nicht gefunden' };
            }

            const playersArray = Array.from(game.players.values());
            
            if (playersArray.length < 2) {
                return { success: false, message: 'Mindestens 2 Spieler erforderlich' };
            }

            if (!playersArray.every(p => p.isReady)) {
                return { success: false, message: 'Nicht alle Spieler sind bereit' };
            }

            // NOW write to database
            const result = await db.query(
                'INSERT INTO games (name, max_players, map_size, status, current_players) VALUES (?, ?, ?, ?, ?)',
                [game.name, game.maxPlayers, game.mapSize, 'race_selection', playersArray.length]
            );

            const dbGameId = result.insertId;

            // Add players to database
            for (let i = 0; i < playersArray.length; i++) {
                const player = playersArray[i];
                await db.query(
                    'INSERT INTO game_players (game_id, player_name, socket_id, is_host, is_ready, turn_order) VALUES (?, ?, ?, ?, ?, ?)',
                    [dbGameId, player.name, player.socketId, player.isHost, true, i + 1]
                );
            }

            // Update memory game with DB ID
            game.dbGameId = dbGameId;
            game.status = 'race_selection';

            console.log(`Game ${game.name} started and saved to DB with ID ${dbGameId}`);

            return {
                success: true,
                dbGameId: dbGameId,
                players: playersArray
            };

        } catch (error) {
            console.error('Error starting game:', error);
            return { success: false, message: 'Fehler beim Starten des Spiels' };
        }
    }

    // Get available games (memory only for waiting games)
    getAvailableGames() {
        const availableGames = [];
        
        for (const [gameId, game] of this.games) {
            if (game.status === 'waiting') {
                const playersArray = Array.from(game.players.values());
                availableGames.push({
                    id: gameId,
                    name: game.name,
                    maxPlayers: game.maxPlayers,
                    currentPlayers: playersArray.length,
                    mapSize: game.mapSize,
                    status: game.status,
                    players: playersArray.map(p => p.name),
                    createdAt: game.createdAt
                });
            }
        }

        return availableGames.sort((a, b) => b.createdAt - a.createdAt);
    }

    // Get players in a specific game
getGamePlayersArray(gameId) {
    const game = this.games.get(gameId);
    if (!game) return [];
    
    return Array.from(game.players.values()).map(player => ({
        socketId: player.socketId,
        name: player.name,
        isHost: player.isHost,
        ready: player.isReady, // Beide Varianten für Kompatibilität
        isReady: player.isReady,
        raceId: player.raceId,
        joinedAt: player.joinedAt
    }));
}

validateGameState(gameId) {
    try {
        const game = this.games.get(gameId);
        if (!game) return false;
        
        // Check if all players in game still exist in players map
        for (const [socketId, gamePlayer] of game.players) {
            const playerData = this.players.get(socketId);
            if (!playerData || playerData.gameId !== gameId) {
                console.warn(`Inconsistent state detected for player ${gamePlayer.name} in game ${gameId}`);
                game.players.delete(socketId);
            }
        }
        
        return true;
    } catch (error) {
        console.error('Error validating game state:', error);
        return false;
    }
}

    // Get player's current game
    getPlayerGame(socketId) {
        const playerData = this.players.get(socketId);
        if (!playerData) return null;
        
        return this.games.get(playerData.gameId);
    }

    // Cleanup disconnected players
    handleDisconnect(socketId) {
        const result = this.leaveGame(socketId);
        console.log(`Player disconnected: ${socketId}`);
        return result;
    }

    // Select race (for race selection phase)
    selectRace(socketId, raceId) {
        try {
            const playerData = this.players.get(socketId);
            if (!playerData) {
                return { success: false, message: 'Spieler nicht gefunden' };
            }

            const game = this.games.get(playerData.gameId);
            if (!game || game.status !== 'race_selection') {
                return { success: false, message: 'Rassenwahl nicht verfügbar' };
            }

            // Check if race already taken
            for (const [socketId, player] of game.players) {
                if (player.raceId === raceId) {
                    return { success: false, message: 'Rasse bereits gewählt' };
                }
            }

            // Set race
            const gamePlayer = game.players.get(socketId);
            gamePlayer.raceId = raceId;
            playerData.raceId = raceId;

            // Check if all players selected races
            const playersArray = Array.from(game.players.values());
            const allRacesSelected = playersArray.every(p => p.raceId !== null);

            return {
                success: true,
                allRacesSelected: allRacesSelected,
                players: this.getGamePlayersArray(playerData.gameId)
            };

        } catch (error) {
            console.error('Error selecting race:', error);
            return { success: false, message: 'Fehler bei der Rassenwahl' };
        }
    }
}

module.exports = new ImprovedLobbyManager();