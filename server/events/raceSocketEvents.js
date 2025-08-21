// KORRIGIERTE Race Socket Events - Fix für "Spiel nicht gefunden" Error
const raceController = require('../controllers/raceController');
const gameController = require('../controllers/gameController');
const improvedLobbyManager = require('../controllers/improvedLobbyManager');

function setupRaceSelectionEvents(io, socket) {
    console.log(`Setting up race selection events for socket ${socket.id}`);

    // Spieler tritt der Rassenauswahl bei - KORRIGIERT
    socket.on('join-race-selection', async (data) => {
        try {
            console.log(`Player ${data.playerName} joining race selection for game ${data.gameId}`);

            // KORRIGIERT: Prüfe zuerst Memory, dann Datenbank
            let gameDbId = data.gameId;
            
            // Falls gameId eine Memory-ID ist, hole die DB-ID
            const gameInfo = improvedLobbyManager.getGameInfo(data.gameId);
            if (gameInfo && gameInfo.gameDbId) {
                gameDbId = gameInfo.gameDbId;
                console.log(`Using DB ID ${gameDbId} from memory ID ${data.gameId}`);
            }

            // Prüfe ob das Spiel in der Datenbank existiert und in der richtigen Phase ist
            const gameResult = await gameController.getGameInfo(gameDbId);
            if (!gameResult.success) {
                console.error(`Game not found in DB: ${gameDbId}`);
                socket.emit('error', { message: 'Spiel nicht gefunden' });
                return;
            }

            const game = gameResult.game;
            if (game.status !== 'race_selection') {
                socket.emit('error', { message: 'Spiel ist nicht in der Rassenauswahl-Phase' });
                return;
            }

            // Füge Socket zu Spielraum hinzu (verwende DB-ID)
            const roomName = `race-selection-${gameDbId}`;
            socket.join(roomName);
            
            // Speichere Spielerinformationen in Socket
            socket.gameId = data.gameId; // Memory ID
            socket.gameDbId = gameDbId;  // DB ID
            socket.playerName = data.playerName;
            socket.roomName = roomName;

            // Bestätige Beitritt
            socket.emit('race-selection-joined', {
                success: true,
                gameId: data.gameId,
                gameDbId: gameDbId,
                playerName: data.playerName,
                roomName: roomName
            });

            console.log(`✅ Player ${data.playerName} joined race selection room: ${roomName}`);

        } catch (error) {
            console.error('Error in join-race-selection:', error);
            socket.emit('error', { message: 'Fehler beim Beitreten der Rassenauswahl: ' + error.message });
        }
    });

    // Verfügbare Rassen abrufen - KORRIGIERT
    socket.on('get-available-races', async (data) => {
        try {
            console.log(`Getting available races for game ${data.gameId}`);
            
            // KORRIGIERT: Verwende gameDbId falls verfügbar
            let gameDbId = data.gameId;
            if (socket.gameDbId) {
                gameDbId = socket.gameDbId;
            } else {
                // Versuche DB-ID aus Memory zu holen
                const gameInfo = improvedLobbyManager.getGameInfo(data.gameId);
                if (gameInfo && gameInfo.gameDbId) {
                    gameDbId = gameInfo.gameDbId;
                }
            }

            const racesResult = await raceController.getAvailableRaces(gameDbId);
            
            if (racesResult.success) {
                socket.emit('available-races', racesResult.races);
                console.log(`✅ Sent ${racesResult.races.length} available races to player`);
            } else {
                socket.emit('error', { message: racesResult.message });
            }

        } catch (error) {
            console.error('Error getting available races:', error);
            socket.emit('error', { message: 'Fehler beim Laden der Rassen: ' + error.message });
        }
    });

    // Alternative Event Namen für bessere Kompatibilität
    socket.on('get_available_races', async (data) => {
        socket.emit('get-available-races', data);
    });

    // Rasse auswählen - KORRIGIERT
    socket.on('select-race', async (data) => {
        try {
            console.log(`Player ${socket.playerName} selecting race ${data.raceId} for game ${data.gameId}`);

            // KORRIGIERT: Verwende gameDbId
            let gameDbId = data.gameId;
            if (socket.gameDbId) {
                gameDbId = socket.gameDbId;
            } else {
                const gameInfo = improvedLobbyManager.getGameInfo(data.gameId);
                if (gameInfo && gameInfo.gameDbId) {
                    gameDbId = gameInfo.gameDbId;
                }
            }

            const result = await raceController.selectRace(gameDbId, socket.playerName, data.raceId);
            
            if (result.success) {
                // Bestätige Auswahl an den Spieler
                socket.emit('race-selected', {
                    success: true,
                    playerName: result.playerName,
                    raceId: result.raceId,
                    raceName: result.raceName
                });

                // Informiere alle Spieler in der Rassenauswahl über die Änderung
                const roomName = `race-selection-${gameDbId}`;
                socket.to(roomName).emit('race-selection-update', {
                    playerName: result.playerName,
                    raceId: result.raceId,
                    raceName: result.raceName,
                    confirmed: false
                });

                console.log(`✅ Race ${result.raceName} selected by ${result.playerName}`);

            } else {
                socket.emit('error', { message: result.message });
            }

        } catch (error) {
            console.error('Error selecting race:', error);
            socket.emit('error', { message: 'Fehler bei der Rassenauswahl: ' + error.message });
        }
    });

    // Rasse bestätigen - KORRIGIERT
    socket.on('confirm-race', async (data) => {
        try {
            console.log(`Player ${socket.playerName} confirming race for game ${data.gameId}`);

            // KORRIGIERT: Verwende gameDbId
            let gameDbId = data.gameId;
            if (socket.gameDbId) {
                gameDbId = socket.gameDbId;
            } else {
                const gameInfo = improvedLobbyManager.getGameInfo(data.gameId);
                if (gameInfo && gameInfo.gameDbId) {
                    gameDbId = gameInfo.gameDbId;
                }
            }

            const result = await raceController.confirmRace(gameDbId, socket.playerName);
            
            if (result.success) {
                // Bestätige Bestätigung an den Spieler
                socket.emit('race-confirmed', {
                    success: true,
                    playerName: result.playerName,
                    raceId: result.raceId,
                    raceName: result.raceName
                });

                // Informiere alle Spieler über die Bestätigung
                const roomName = `race-selection-${gameDbId}`;
                io.to(roomName).emit('race-selection-update', {
                    playerName: result.playerName,
                    raceId: result.raceId,
                    raceName: result.raceName,
                    confirmed: true
                });

                // Prüfe ob alle Spieler ihre Rasse bestätigt haben
                const allConfirmedResult = await raceController.checkAllRacesConfirmed(gameDbId);
                
                if (allConfirmedResult.success && allConfirmedResult.allConfirmed) {
                    console.log(`🎮 All races confirmed for game ${gameDbId}, starting map generation...`);
                    
                    // Alle Rassen bestätigt - starte Kartengenerierung
                    io.to(roomName).emit('all-races-confirmed', {
                        gameId: data.gameId,
                        gameDbId: gameDbId,
                        message: 'Alle Spieler haben ihre Rassen bestätigt! Die Karte wird generiert...'
                    });

                    // TODO: Hier später Kartengenerierung starten
                    // await mapController.generateMap(gameDbId);
                }

                console.log(`✅ Race confirmed by ${result.playerName}`);

            } else {
                socket.emit('error', { message: result.message });
            }

        } catch (error) {
            console.error('Error confirming race:', error);
            socket.emit('error', { message: 'Fehler bei der Rassenbestätigung: ' + error.message });
        }
    });

    // Aktuelle Rassenauswahlen abrufen - KORRIGIERT
    socket.on('get-race-selections', async (data) => {
        try {
            // KORRIGIERT: Verwende gameDbId
            let gameDbId = data.gameId;
            if (socket.gameDbId) {
                gameDbId = socket.gameDbId;
            } else {
                const gameInfo = improvedLobbyManager.getGameInfo(data.gameId);
                if (gameInfo && gameInfo.gameDbId) {
                    gameDbId = gameInfo.gameDbId;
                }
            }

            const result = await raceController.getAllRaceSelections(gameDbId);
            
            if (result.success) {
                socket.emit('race-selections', {
                    gameId: data.gameId,
                    gameDbId: gameDbId,
                    selections: result.selections
                });
            } else {
                socket.emit('error', { message: result.message });
            }

        } catch (error) {
            console.error('Error getting race selections:', error);
            socket.emit('error', { message: 'Fehler beim Laden der Rassenauswahlen: ' + error.message });
        }
    });

    // Rassenauswahl zurücksetzen (nur für Host) - KORRIGIERT
    socket.on('reset-race-selections', async (data) => {
        try {
            console.log(`Resetting race selections for game ${data.gameId}`);

            // KORRIGIERT: Verwende gameDbId
            let gameDbId = data.gameId;
            if (socket.gameDbId) {
                gameDbId = socket.gameDbId;
            } else {
                const gameInfo = improvedLobbyManager.getGameInfo(data.gameId);
                if (gameInfo && gameInfo.gameDbId) {
                    gameDbId = gameInfo.gameDbId;
                }
            }

            // Prüfe ob Spieler Host ist (aus Memory)
            const playerData = improvedLobbyManager.players.get(socket.id);
            if (!playerData || !playerData.isHost) {
                socket.emit('error', { message: 'Nur der Host kann die Rassenauswahlen zurücksetzen' });
                return;
            }

            const result = await raceController.resetRaceSelections(gameDbId);
            
            if (result.success) {
                // Informiere alle Spieler über das Zurücksetzen
                const roomName = `race-selection-${gameDbId}`;
                io.to(roomName).emit('race-selections-reset', {
                    gameId: data.gameId,
                    gameDbId: gameDbId,
                    message: 'Rassenauswahlen wurden zurückgesetzt'
                });

                console.log(`✅ Race selections reset for game ${gameDbId}`);

            } else {
                socket.emit('error', { message: result.message });
            }

        } catch (error) {
            console.error('Error resetting race selections:', error);
            socket.emit('error', { message: 'Fehler beim Zurücksetzen: ' + error.message });
        }
    });

    // Spiel verlassen (von Rassenauswahl) - KORRIGIERT
    socket.on('leave-race-selection', async (data) => {
        try {
            console.log(`Player ${socket.playerName} leaving race selection`);

            if (socket.roomName) {
                socket.leave(socket.roomName);
                console.log(`Player left room: ${socket.roomName}`);
            }

            // Zurück zum Lobby-Manager
            if (socket.gameId) {
                const result = await improvedLobbyManager.leaveGame(socket.id);
                
                if (result.success) {
                    socket.emit('returned-to-lobby', {
                        success: true,
                        message: 'Zurück zur Lobby'
                    });
                } else {
                    socket.emit('error', { message: result.message });
                }
            }

        } catch (error) {
            console.error('Error leaving race selection:', error);
            socket.emit('error', { message: 'Fehler beim Verlassen: ' + error.message });
        }
    });

    // Disconnect cleanup - KORRIGIERT
    socket.on('disconnect', () => {
        try {
            console.log(`Socket ${socket.id} disconnected from race selection`);
            
            if (socket.roomName) {
                socket.leave(socket.roomName);
                console.log(`Socket left race selection room: ${socket.roomName}`);
            }

        } catch (error) {
            console.error('Error in race selection disconnect:', error);
        }
    });
}

// NEUE Hilfsfunktion: DB-ID aus verschiedenen Quellen ermitteln
function resolveGameDbId(gameId, socket, improvedLobbyManager) {
    // 1. Aus Socket gespeicherte DB-ID
    if (socket.gameDbId) {
        return socket.gameDbId;
    }
    
    // 2. Aus Memory Manager
    const gameInfo = improvedLobbyManager.getGameInfo(gameId);
    if (gameInfo && gameInfo.gameDbId) {
        return gameInfo.gameDbId;
    }
    
    // 3. Assume gameId ist bereits DB-ID
    return gameId;
}

module.exports = { setupRaceSelectionEvents };