// Socket Events für Rassenauswahl
const raceController = require('../controllers/raceController');
const gameController = require('../controllers/gameController');

function setupRaceSelectionEvents(io, socket) {
    console.log(`Setting up race selection events for socket ${socket.id}`);

    // Spieler tritt der Rassenauswahl bei
    socket.on('join-race-selection', async (data) => {
        try {
            console.log(`Player ${data.playerName} joining race selection for game ${data.gameId}`);

            // Prüfe ob das Spiel existiert und in der richtigen Phase ist
            const gameResult = await gameController.getGameInfo(data.gameId);
            if (!gameResult.success) {
                socket.emit('error', { message: 'Spiel nicht gefunden' });
                return;
            }

            const game = gameResult.game;
            if (game.status !== 'race_selection') {
                socket.emit('error', { message: 'Spiel ist nicht in der Rassenauswahl-Phase' });
                return;
            }

            // Füge Socket zu Spielraum hinzu
            const roomName = `race-selection-${data.gameId}`;
            socket.join(roomName);
            
            // Speichere Spielerinformationen in Socket
            socket.gameId = data.gameId;
            socket.playerName = data.playerName;
            socket.roomName = roomName;

            // Bestätige Beitritt
            socket.emit('race-selection-joined', {
                success: true,
                game: game,
                message: 'Erfolgreich der Rassenauswahl beigetreten'
            });

            // Sende Updates an alle Spieler im Raum
            await broadcastRaceSelectionUpdate(io, data.gameId);

            console.log(`✓ Player ${data.playerName} joined race selection room: ${roomName}`);

        } catch (error) {
            console.error('Error joining race selection:', error);
            socket.emit('error', { message: 'Fehler beim Beitreten der Rassenauswahl' });
        }
    });

    // Hole verfügbare Rassen
    socket.on('get-available-races', async (data) => {
        try {
            console.log(`Loading available races for game ${data.gameId}`);

            const result = await raceController.getAvailableRaces();
            if (result.success) {
                socket.emit('available-races', result.races);
            } else {
                socket.emit('error', { message: result.message });
            }

        } catch (error) {
            console.error('Error getting available races:', error);
            socket.emit('error', { message: 'Fehler beim Laden der Rassen' });
        }
    });

    // Hole Rassendetails
    socket.on('get-race-details', async (data) => {
        try {
            console.log(`Loading race details for race ${data.raceId}`);

            const result = await raceController.getRaceDetails(data.raceId);
            if (result.success) {
                socket.emit('race-details', {
                    success: true,
                    race: result.race,
                    units: result.units
                });
            } else {
                socket.emit('race-details', { success: false, message: result.message });
            }

        } catch (error) {
            console.error('Error getting race details:', error);
            socket.emit('race-details', { success: false, message: 'Fehler beim Laden der Rassendetails' });
        }
    });

    // Spieler wählt Rasse aus
    socket.on('select-race', async (data) => {
        try {
            console.log(`Player ${data.playerName} selecting race ${data.raceId} for game ${data.gameId}`);

            const result = await raceController.selectRace(data.gameId, data.playerName, data.raceId);
            
            // Antwort an den Spieler
            socket.emit('race-selected', result);

            if (result.success) {
                // Broadcastе Update an alle Spieler
                await broadcastRaceSelectionUpdate(io, data.gameId);
            }

        } catch (error) {
            console.error('Error selecting race:', error);
            socket.emit('race-selected', { success: false, message: 'Fehler bei der Rassenauswahl' });
        }
    });

    // Spieler bestätigt Rassenauswahl
    socket.on('confirm-race', async (data) => {
        try {
            console.log(`Player ${data.playerName} confirming race for game ${data.gameId}`);

            const result = await raceController.confirmRace(data.gameId, data.playerName);
            
            // Antwort an den Spieler
            socket.emit('race-confirmed', result);

            if (result.success) {
                // Broadcastе Update an alle Spieler
                await broadcastRaceSelectionUpdate(io, data.gameId);

                // Wenn alle Spieler bereit sind, starte Kartengenerierung
                if (result.allReady) {
                    console.log(`All players ready for game ${data.gameId}, starting map generation...`);
                    
                    // Benachrichtige alle Spieler
                    io.to(`race-selection-${data.gameId}`).emit('all-races-selected');

                    // Starte Kartengenerierung
                    const mapResult = await raceController.startMapGeneration(data.gameId);
                    if (mapResult.success) {
                        // Generiere die eigentliche Karte (später implementiert)
                        setTimeout(async () => {
                            // Simuliere Kartengenerierung (später durch echte Logik ersetzen)
                            console.log(`Map generation completed for game ${data.gameId}`);
                            
                            // Benachrichtige alle Spieler dass das Spiel startet
                            io.to(`race-selection-${data.gameId}`).emit('game-started', {
                                gameId: data.gameId,
                                message: 'Karte generiert - Spiel startet!'
                            });
                        }, 3000); // 3 Sekunden Simulation
                    }
                }
            }

        } catch (error) {
            console.error('Error confirming race:', error);
            socket.emit('race-confirmed', { success: false, message: 'Fehler bei der Rassenbestätigung' });
        }
    });

    // Spieler hebt Rassenauswahl auf
    socket.on('deselect-race', async (data) => {
        try {
            console.log(`Player ${data.playerName} deselecting race for game ${data.gameId}`);

            const result = await raceController.deselectRace(data.gameId, data.playerName);
            
            // Antwort an den Spieler
            socket.emit('race-deselected', result);

            if (result.success) {
                // Broadcast Update an alle Spieler
                await broadcastRaceSelectionUpdate(io, data.gameId);
            }

        } catch (error) {
            console.error('Error deselecting race:', error);
            socket.emit('race-deselected', { success: false, message: 'Fehler beim Zurücksetzen der Rassenauswahl' });
        }
    });

    // Spieler verlässt Rassenauswahl
    socket.on('leave-race-selection', async () => {
        try {
            if (socket.gameId && socket.roomName) {
                console.log(`Player ${socket.playerName} leaving race selection for game ${socket.gameId}`);
                
                socket.leave(socket.roomName);
                
                // Broadcast Update an verbleibende Spieler
                await broadcastRaceSelectionUpdate(io, socket.gameId);
            }

        } catch (error) {
            console.error('Error leaving race selection:', error);
        }
    });

    // Disconnect Handling
    socket.on('disconnect', async () => {
        try {
            if (socket.gameId && socket.playerName) {
                console.log(`Player ${socket.playerName} disconnected from race selection`);
                
                // Broadcast Update an verbleibende Spieler
                await broadcastRaceSelectionUpdate(io, socket.gameId);
            }

        } catch (error) {
            console.error('Error handling disconnect in race selection:', error);
        }
    });
}

// Hilfsfunktion: Broadcast Race Selection Updates an alle Spieler
async function broadcastRaceSelectionUpdate(io, gameId) {
    try {
        // Hole aktuelle Auswahlstände (ohne Details zu zeigen wer was gewählt hat)
        const selectionsResult = await raceController.getAllRaceSelections(gameId);
        const readyCountResult = await raceController.getReadyCount(gameId);

        if (selectionsResult.success && readyCountResult.success) {
            const roomName = `race-selection-${gameId}`;
            
            // Sende Update an alle Spieler im Raum
            // Hinweis: Wir senden nur die Anzahl bereiter Spieler, nicht wer was gewählt hat
            io.to(roomName).emit('race-selection-update', {
                readyCount: readyCountResult.readyCount,
                totalPlayers: readyCountResult.totalPlayers,
                // selections werden nicht gesendet um Geheimhaltung zu wahren
                selections: [] // Leeres Array - andere Spieler sehen nicht was gewählt wurde
            });

            console.log(`Broadcasted race selection update to room ${roomName}: ${readyCountResult.readyCount}/${readyCountResult.totalPlayers} ready`);
        }

    } catch (error) {
        console.error('Error broadcasting race selection update:', error);
    }
}

module.exports = {
    setupRaceSelectionEvents,
    broadcastRaceSelectionUpdate
};