// Race Selection Controller - server/controllers/raceController.js
const db = require('../config/database');

class RaceController {
    // Lade alle verfügbaren Rassen aus der Datenbank
    async getAvailableRaces() {
        try {
            console.log('Loading available races from database...');
            
            const races = await db.query(`
                SELECT 
                    r.*,
                    COUNT(u.id) as unit_count
                FROM races r
                LEFT JOIN units u ON r.id = u.race_id
                GROUP BY r.id
                ORDER BY r.name
            `);

            console.log(`Found ${races.length} races in database`);
            return { success: true, races: races };

        } catch (error) {
            console.error('Error loading races:', error);
            return { success: false, message: 'Fehler beim Laden der Rassen: ' + error.message };
        }
    }

    // Lade Details einer spezifischen Rasse mit ihren Einheiten
    async getRaceDetails(raceId) {
        try {
            console.log(`Loading race details for race ID: ${raceId}`);

            // Lade Rasseninformationen
            const raceInfo = await db.query(
                'SELECT * FROM races WHERE id = ?',
                [raceId]
            );

            if (raceInfo.length === 0) {
                return { success: false, message: 'Rasse nicht gefunden' };
            }

            // Lade alle Einheiten dieser Rasse
            const units = await db.query(`
                SELECT 
                    id, name, cost, attack_power, health, 
                    movement_points, attack_range, description
                FROM units 
                WHERE race_id = ? 
                ORDER BY cost, name
            `, [raceId]);

            console.log(`Found ${units.length} units for race ${raceInfo[0].name}`);

            return {
                success: true,
                race: raceInfo[0],
                units: units
            };

        } catch (error) {
            console.error('Error loading race details:', error);
            return { success: false, message: 'Fehler beim Laden der Rassendetails: ' + error.message };
        }
    }

    // Spieler wählt eine Rasse aus (noch nicht bestätigt)
    async selectRace(gameId, playerName, raceId) {
        try {
            console.log(`Player ${playerName} selecting race ${raceId} for game ${gameId}`);

            // Prüfe ob das Spiel in der Rassenauswahl-Phase ist
            const game = await db.query(
                'SELECT id, status FROM games WHERE id = ? AND status = "race_selection"',
                [gameId]
            );

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenauswahl-Phase' };
            }

            // Prüfe ob die Rasse existiert
            const race = await db.query('SELECT id, name FROM races WHERE id = ?', [raceId]);
            if (race.length === 0) {
                return { success: false, message: 'Rasse nicht gefunden' };
            }

            // Prüfe ob der Spieler existiert
            const player = await db.query(
                'SELECT id, player_name FROM game_players WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            if (player.length === 0) {
                return { success: false, message: 'Spieler nicht in diesem Spiel gefunden' };
            }

            // Update Spieler mit ausgewählter Rasse (noch nicht bestätigt)
            await db.query(
                'UPDATE game_players SET race_id = ?, race_confirmed = 0 WHERE game_id = ? AND player_name = ?',
                [raceId, gameId, playerName]
            );

            console.log(`✓ Race ${race[0].name} selected for player ${playerName}`);

            return {
                success: true,
                playerName: playerName,
                raceId: raceId,
                raceName: race[0].name
            };

        } catch (error) {
            console.error('Error selecting race:', error);
            return { success: false, message: 'Fehler bei der Rassenauswahl: ' + error.message };
        }
    }

    // Spieler bestätigt seine Rassenauswahl
    async confirmRace(gameId, playerName, raceId) {
        try {
            console.log(`Player ${playerName} confirming race ${raceId} for game ${gameId}`);

            // Prüfe ob das Spiel in der Rassenauswahl-Phase ist
            const game = await db.query(
                'SELECT id, status FROM games WHERE id = ? AND status = "race_selection"',
                [gameId]
            );

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenauswahl-Phase' };
            }

            // Prüfe ob der Spieler die Rasse bereits ausgewählt hat
            const player = await db.query(
                'SELECT id, race_id FROM game_players WHERE game_id = ? AND player_name = ? AND race_id = ?',
                [gameId, playerName, raceId]
            );

            if (player.length === 0) {
                return { success: false, message: 'Rasse muss zuerst ausgewählt werden' };
            }

            // Bestätige die Rassenauswahl
            await db.query(
                'UPDATE game_players SET race_confirmed = 1 WHERE game_id = ? AND player_name = ? AND race_id = ?',
                [gameId, playerName, raceId]
            );

            console.log(`✓ Race confirmed for player ${playerName}`);

            // Prüfe ob alle Spieler ihre Rasse bestätigt haben
            const allPlayersReady = await this.checkAllPlayersReady(gameId);

            return {
                success: true,
                playerName: playerName,
                raceId: raceId,
                allReady: allPlayersReady.allReady,
                readyCount: allPlayersReady.readyCount,
                totalCount: allPlayersReady.totalCount
            };

        } catch (error) {
            console.error('Error confirming race:', error);
            return { success: false, message: 'Fehler bei der Rassenbestätigung: ' + error.message };
        }
    }

    // Spieler deselektiert seine Rasse (um sie zu ändern)
    async deselectRace(gameId, playerName) {
        try {
            console.log(`Player ${playerName} deselecting race for game ${gameId}`);

            // Prüfe ob das Spiel in der Rassenauswahl-Phase ist
            const game = await db.query(
                'SELECT id, status FROM games WHERE id = ? AND status = "race_selection"',
                [gameId]
            );

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenwahl-Phase' };
            }

            // Prüfe ob der Spieler existiert
            const player = await db.query(
                'SELECT id, player_name, race_id, race_confirmed FROM game_players WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            if (player.length === 0) {
                return { success: false, message: 'Spieler nicht in diesem Spiel gefunden' };
            }

            // Erlaube Deselection auch von bestätigten Rassen (für "Rasse ändern" Funktion)
            console.log(`Allowing deselection for player ${playerName} (was confirmed: ${player[0].race_confirmed})`);

            // WICHTIG: Entferne die Rassenwahl komplett aus der Datenbank
            await db.query(
                'UPDATE game_players SET race_id = NULL, race_confirmed = 0 WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            console.log(`✓ Race COMPLETELY REMOVED FROM DATABASE for player ${playerName}`);

            return {
                success: true,
                playerName: playerName,
                wasConfirmed: player[0].race_confirmed === 1
            };

        } catch (error) {
            console.error('Error deselecting race:', error);
            return { success: false, message: 'Fehler bei der Rassenabwahl: ' + error.message };
        }
    }

    // Prüfe ob alle Spieler bereit sind
    async checkAllPlayersReady(gameId) {
        try {
            const players = await db.query(`
                SELECT 
                    COUNT(*) as total_players,
                    SUM(CASE WHEN race_confirmed = 1 THEN 1 ELSE 0 END) as ready_players
                FROM game_players 
                WHERE game_id = ? AND is_active = 1
            `, [gameId]);

            const totalCount = players[0].total_players;
            const readyCount = players[0].ready_players;
            const allReady = totalCount > 0 && readyCount === totalCount;

            console.log(`Game ${gameId}: ${readyCount}/${totalCount} players ready (all ready: ${allReady})`);

            return {
                success: true,
                allReady: allReady,
                readyCount: readyCount,
                totalCount: totalCount
            };

        } catch (error) {
            console.error('Error checking players ready:', error);
            return { success: false, message: 'Fehler beim Prüfen der Spielerbereitschaft' };
        }
    }

    // Lade alle Rassenauswahlen für ein Spiel
async getAllRaceSelections(gameId) {
    try {
        console.log(`Getting all race selections for game ${gameId}`);

        // Hole alle Spieler und ihre Rassenauswahlen
        const selections = await db.query(`
            SELECT 
                gp.id as player_id,
                gp.player_name,
                gp.race_id,
                gp.race_confirmed,
                gp.socket_id,
                r.name as race_name,
                r.color_hex as race_color
            FROM game_players gp
            LEFT JOIN races r ON gp.race_id = r.id
            WHERE gp.game_id = ? AND gp.is_active = 1
            ORDER BY gp.player_name
        `, [gameId]);

        // Statistiken berechnen
        const stats = await this.getAllConfirmedRaces(gameId);

        console.log(`✅ Race selections retrieved: ${selections.length} players`);

        return {
            success: true,
            gameId: gameId,
            selections: selections,
            stats: stats
        };

    } catch (error) {
        console.error('Error getting race selections:', error);
        return { success: false, message: 'Fehler beim Laden der Rassenauswahlen: ' + error.message };
    }
}

async confirmRaceSelection(gameId, playerName, raceId) {
    try {
        console.log(`Confirming race selection: ${playerName} -> Race ${raceId} in game ${gameId}`);

        // Prüfe ob das Spiel existiert und in der richtigen Phase ist
        const game = await db.query(
            'SELECT * FROM games WHERE id = ? AND status = "race_selection"',
            [gameId]
        );

        if (game.length === 0) {
            return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenauswahl-Phase' };
        }

        // Prüfe ob der Spieler existiert
        const player = await db.query(
            'SELECT * FROM game_players WHERE game_id = ? AND player_name = ? AND is_active = 1',
            [gameId, playerName]
        );

        if (player.length === 0) {
            return { success: false, message: 'Spieler nicht in diesem Spiel gefunden' };
        }

        // Prüfe ob die Rasse bereits ausgewählt ist
        const currentSelection = await db.query(
            'SELECT race_id, race_confirmed FROM game_players WHERE game_id = ? AND player_name = ?',
            [gameId, playerName]
        );

        if (currentSelection.length > 0 && currentSelection[0].race_id !== raceId) {
            return { success: false, message: 'Du hast bereits eine andere Rasse ausgewählt' };
        }

        if (currentSelection.length > 0 && currentSelection[0].race_confirmed === 1) {
            return { success: false, message: 'Du hast bereits eine Rasse bestätigt' };
        }

        // Bestätige die Rassenauswahl
        await db.query(
            'UPDATE game_players SET race_id = ?, race_confirmed = 1 WHERE game_id = ? AND player_name = ?',
            [raceId, gameId, playerName]
        );

        console.log(`✅ Race confirmed: ${playerName} -> Race ${raceId} in game ${gameId}`);

        return {
            success: true,
            gameId: gameId,
            playerName: playerName,
            raceId: raceId,
            confirmed: true
        };

    } catch (error) {
        console.error('Error confirming race selection:', error);
        return { success: false, message: 'Fehler beim Bestätigen der Rasse: ' + error.message };
    }
}

// Hilfsmethode: Prüfe ob alle Spieler ihre Rassen bestätigt haben
async getAllConfirmedRaces(gameId) {
    try {
        const result = await db.query(`
            SELECT 
                COUNT(*) as total_players,
                SUM(CASE WHEN race_id IS NOT NULL AND race_confirmed = 1 THEN 1 ELSE 0 END) as confirmed_players,
                SUM(CASE WHEN race_id IS NOT NULL AND race_confirmed = 0 THEN 1 ELSE 0 END) as selected_but_not_confirmed
            FROM game_players 
            WHERE game_id = ? AND is_active = 1
        `, [gameId]);

        const stats = result[0];
        
        return {
            success: true,
            totalPlayers: stats.total_players,
            confirmedPlayers: stats.confirmed_players,
            selectedButNotConfirmed: stats.selected_but_not_confirmed,
            allConfirmed: stats.total_players > 0 && stats.confirmed_players === stats.total_players
        };

    } catch (error) {
        console.error('Error getting confirmed races:', error);
        return { success: false, message: error.message };
    }
}

    // Starte das eigentliche Spiel (nach Rassenauswahl)
    async startGame(gameId) {
        try {
            console.log(`Starting actual game for DB game ${gameId}`);

            // Prüfe ob alle Spieler bereit sind
            const readyCheck = await this.checkAllPlayersReady(gameId);
            if (!readyCheck.success || !readyCheck.allReady) {
                return { success: false, message: 'Nicht alle Spieler haben ihre Rasse ausgewählt' };
            }

            // Update Spielstatus zu "playing"
            await db.query(
                'UPDATE games SET status = "playing", started_at = NOW() WHERE id = ?',
                [gameId]
            );

            // TODO: Hier würde die Kartengenerierung stattfinden
            // await this.generateMap(gameId);

            console.log(`✓ Game ${gameId} started successfully`);

            return {
                success: true,
                gameId: gameId,
                message: 'Spiel wurde gestartet'
            };

        } catch (error) {
            console.error('Error starting game:', error);
            return { success: false, message: 'Fehler beim Starten des Spiels: ' + error.message };
        }
    }

    // Hilfsfunktion: Spieler einem Spiel beitreten lassen für Rassenauswahl
    async joinRaceSelection(gameId, playerName, socketId) {
        try {
            console.log(`Player ${playerName} joining race selection for game ${gameId}`);

            // Prüfe ob das Spiel existiert und in der race_selection Phase ist
            const game = await db.query(
                'SELECT id, status, max_players FROM games WHERE id = ? AND status = "race_selection"',
                [gameId]
            );

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenauswahl-Phase' };
            }

            // Prüfe ob der Spieler bereits in diesem Spiel ist
            const existingPlayer = await db.query(
                'SELECT id, player_name FROM game_players WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            if (existingPlayer.length === 0) {
                return { success: false, message: 'Spieler nicht in diesem Spiel gefunden' };
            }

            // Update Socket-ID für den Spieler
            await db.query(
                'UPDATE game_players SET socket_id = ? WHERE game_id = ? AND player_name = ?',
                [socketId, gameId, playerName]
            );

            // Lade Spielerinformationen
            const totalPlayers = await db.query(
                'SELECT COUNT(*) as count FROM game_players WHERE game_id = ? AND is_active = 1',
                [gameId]
            );

            console.log(`✓ Player ${playerName} joined race selection for game ${gameId}`);

            return {
                success: true,
                gameId: gameId,
                playerName: playerName,
                totalPlayers: totalPlayers[0].count
            };

        } catch (error) {
            console.error('Error joining race selection:', error);
            return { success: false, message: 'Fehler beim Beitreten der Rassenauswahl: ' + error.message };
        }
    }

    // Spieler verlässt die Rassenauswahl
    async leaveRaceSelection(gameId, playerName) {
        try {
            console.log(`Player ${playerName} leaving race selection for game ${gameId}`);

            // Reset race selection für den Spieler
            await db.query(
                'UPDATE game_players SET race_id = NULL, race_confirmed = 0, socket_id = NULL WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            console.log(`✓ Player ${playerName} left race selection for game ${gameId}`);

            return { success: true };

        } catch (error) {
            console.error('Error leaving race selection:', error);
            return { success: false, message: 'Fehler beim Verlassen der Rassenauswahl' };
        }
    }
}

module.exports = new RaceController();