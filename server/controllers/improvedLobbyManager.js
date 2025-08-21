// Improved Lobby Manager - KORRIGIERT für Datenbank-Synchronisation
const gameController = require('./gameController');

class ImprovedLobbyManager {
    constructor() {
        this.games = new Map(); // In-Memory Games: gameId -> gameData
        this.players = new Map(); // socketId -> playerData
        this.gameIdCounter = 1;
    }

    // Create new game - KORRIGIERT: Auch in Datenbank speichern
    async createGame(socketId, playerName, gameName, maxPlayers = 8, mapSize = 30) {
        try {
            // 1. Erstelle Spiel in der Datenbank
            const dbResult = await gameController.createGame(gameName, maxPlayers, mapSize);
            if (!dbResult.success) {
                return { success: false, message: dbResult.message };
            }

            const gameDbId = dbResult.gameId;

            // 2. Füge Spieler zur Datenbank hinzu
            const playerResult = await gameController.addPlayerToGame(gameDbId, playerName, true); // true = isHost
            if (!playerResult.success) {
                return { success: false, message: playerResult.message };
            }

            // 3. Erstelle Spiel im Arbeitsspeicher
            const gameId = this.gameIdCounter++;
            const gameData = {
                id: gameId,
                dbId: gameDbId, // WICHTIG: Verknüpfung zur Datenbank-ID
                name: gameName,
                maxPlayers: maxPlayers,
                mapSize: mapSize,
                status: 'waiting',
                createdAt: new Date(),
                players: new Map()
            };

            // 4. Host-Spieler hinzufügen
            const playerData = {
                socketId: socketId,
                name: playerName.trim(),
                isHost: true,
                isReady: false,
                raceId: null,
                joinedAt: new Date()
            };

            gameData.players.set(socketId, playerData);
            this.games.set(gameId, gameData);
            this.players.set(socketId, { gameId: gameId, dbId: gameDbId, ...playerData });

            console.log(`✅ Game created: "${gameName}" (Memory ID: ${gameId}, DB ID: ${gameDbId}) by ${playerName}`);

            return {
                success: true,
                gameId: gameId,
                gameDbId: gameDbId, // WICHTIG: Auch DB-ID zurückgeben
                gameName: gameName,
                maxPlayers: maxPlayers,
                mapSize: mapSize,
                isHost: true,
                players: this.getGamePlayersArray(gameId),
                currentPlayers: 1
            };

        } catch (error) {
            console.error('Error creating game:', error);
            return { success: false, message: 'Fehler beim Erstellen des Spiels' };
        }
    }

    // Join game - KORRIGIERT: Auch in Datenbank hinzufügen
    async joinGame(socketId, playerName, gameId) {
        try {
            const game = this.games.get(parseInt(gameId)); // WICHTIG: parseInt für numerische IDs
            
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

            // 1. Füge Spieler zur Datenbank hinzu
            const dbResult = await gameController.addPlayerToGame(game.dbId, playerName, false); // false = not host
            if (!dbResult.success) {
                return { success: false, message: dbResult.message };
            }

            // 2. Add player to memory
            const playerData = {
                socketId: socketId,
                name: playerName.trim(),
                isHost: false,
                isReady: false,
                raceId: null,
                joinedAt: new Date()
            };

            game.players.set(socketId, playerData);
            this.players.set(socketId, { gameId: gameId, dbId: game.dbId, ...playerData });

            console.log(`✅ Player ${playerName} joined game ${game.name} (Memory ID: ${gameId}, DB ID: ${game.dbId})`);

            const playersArray = this.getGamePlayersArray(gameId);

            return {
                success: true,
                gameId: gameId,
                gameDbId: game.dbId, // WICHTIG: DB-ID für Frontend
                gameName: game.name,
                maxPlayers: game.maxPlayers,
                mapSize: game.mapSize,
                isHost: false,
                players: playersArray,
                currentPlayers: playersArray.length
            };

        } catch (error) {
            console.error('Error joining game:', error);
            return { success: false, message: 'Fehler beim Beitreten des Spiels' };
        }
    }

    // KORRIGIERT: Start race selection - Update auch Datenbank
    async startRaceSelection(gameId) {
        try {
            const game = this.games.get(gameId);
            if (!game) {
                return { success: false, message: 'Spiel nicht gefunden' };
            }

            // 1. Update memory status
            game.status = 'race_selection';

            // 2. Update database status
            const dbResult = await gameController.startRaceSelection(game.dbId);
            if (!dbResult.success) {
                console.error('Failed to update DB status to race_selection:', dbResult.message);
                // Continue anyway, memory is primary
            }

            console.log(`✅ Race selection started for game ${game.name} (Memory ID: ${gameId}, DB ID: ${game.dbId})`);

            return {
                success: true,
                gameDbId: game.dbId // WICHTIG: DB-ID für Race Selection
            };

        } catch (error) {
            console.error('Error starting race selection:', error);
            return { success: false, message: 'Fehler beim Starten der Rassenauswahl' };
        }
    }

    // Get game info by memory ID
    getGameInfo(gameId) {
        try {
            const game = this.games.get(parseInt(gameId));
            if (!game) {
                return null;
            }
            
            const playersArray = this.getGamePlayersArray(gameId);
            
            return {
                gameId: gameId,
                gameDbId: game.dbId, // WICHTIG: DB-ID auch hier
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

    // NEUE Methode: Get game by DB ID
    getGameByDbId(dbId) {
        try {
            for (const [gameId, game] of this.games) {
                if (game.dbId === parseInt(dbId)) {
                    return {
                        memoryId: gameId,
                        game: game
                    };
                }
            }
            return null;
        } catch (error) {
            console.error('Error getting game by DB ID:', error);
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

    // Leave game - KORRIGIERT: Auch aus Datenbank entfernen
    async leaveGame(socketId) {
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
            const gameDbId = game.dbId;
            
            // 1. Remove from database
            try {
                await gameController.removePlayerFromGame(gameDbId, playerName);
            } catch (dbError) {
                console.error('Error removing player from DB:', dbError);
                // Continue with memory cleanup
            }

            // 2. Remove player from memory
            game.players.delete(socketId);
            this.players.delete(socketId);

            console.log(`Player ${playerName} left game ${game.name} (ID: ${gameId})`);

            // Check if game should be deleted
            if (game.players.size === 0) {
                // Delete from memory
                this.games.delete(gameId);
                
                // Delete from database
                try {
                    await gameController.deleteGame(gameDbId);
                } catch (dbError) {
                    console.error('Error deleting game from DB:', dbError);
                }

                console.log(`Game ${game.name} deleted (last player left)`);
                return {
                    success: true,
                    gameDeleted: true,
                    playerName: playerName,
                    players: []
                };
            }

            // If host left, promote another player to host
            if (isHost && game.players.size > 0) {
                const newHost = Array.from(game.players.values())[0];
                newHost.isHost = true;
                this.players.get(newHost.socketId).isHost = true;
                
                // Update in database
                try {
                    await gameController.updatePlayerHost(gameDbId, newHost.name, true);
                } catch (dbError) {
                    console.error('Error updating host in DB:', dbError);
                }

                console.log(`${newHost.name} is now host of game ${game.name}`);
            }

            return {
                success: true,
                gameDeleted: false,
                playerName: playerName,
                players: this.getGamePlayersArray(gameId)
            };

        } catch (error) {
            console.error('Error leaving game:', error);
            return { success: false, message: 'Fehler beim Verlassen des Spiels' };
        }
    }

    // Get available games for the lobby
    getAvailableGames() {
        const availableGames = [];
        
        this.games.forEach((game, gameId) => {
            if (game.status === 'waiting') {
                availableGames.push({
                    id: gameId,
                    dbId: game.dbId, // WICHTIG: DB-ID auch hier
                    name: game.name,
                    currentPlayers: game.players.size,
                    maxPlayers: game.maxPlayers,
                    mapSize: game.mapSize,
                    status: game.status,
                    createdAt: game.createdAt
                });
            }
        });
        
        return availableGames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Helper method to convert players Map to Array
    getGamePlayersArray(gameId) {
        const game = this.games.get(gameId);
        if (!game) return [];
        
        return Array.from(game.players.values()).map(player => ({
            name: player.name,
            isHost: player.isHost,
            isReady: player.isReady,
            ready: player.isReady, // Alias für Kompatibilität
            raceId: player.raceId,
            joinedAt: player.joinedAt
        }));
    }

    // Clean up on disconnect - KORRIGIERT
    async handleDisconnect(socketId) {
        try {
            const playerData = this.players.get(socketId);
            if (playerData) {
                await this.leaveGame(socketId);
            }
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    }

    // Debug method
    getDebugInfo() {
        return {
            totalGames: this.games.size,
            totalPlayers: this.players.size,
            games: Array.from(this.games.entries()).map(([id, game]) => ({
                id: id,
                dbId: game.dbId,
                name: game.name,
                status: game.status,
                playerCount: game.players.size
            }))
        };
    }
}

module.exports = new ImprovedLobbyManager();