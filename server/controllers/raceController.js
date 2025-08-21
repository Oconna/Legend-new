// Race Selection Controller
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

            // Aktualisiere die Rassenauswahl (noch nicht bestätigt)
            await db.query(
                'UPDATE game_players SET race_id = ?, race_confirmed = 0 WHERE game_id = ? AND player_name = ?',
                [raceId, gameId, playerName]
            );

            console.log(`✓ Race ${race[0].name} selected (not confirmed) for player ${playerName}`);

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
    async confirmRace(gameId, playerName) {
        try {
            console.log(`Player ${playerName} confirming race selection for game ${gameId}`);

            // Prüfe ob das Spiel in der Rassenauswahl-Phase ist
            const game = await db.query(
                'SELECT id, status FROM games WHERE id = ? AND status = "race_selection"',
                [gameId]
            );

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenauswahl-Phase' };
            }

            // Prüfe ob der Spieler eine Rasse ausgewählt hat
            const player = await db.query(
                'SELECT id, player_name, race_id FROM game_players WHERE game_id = ? AND player_name = ? AND race_id IS NOT NULL',
                [gameId, playerName]
            );

            if (player.length === 0) {
                return { success: false, message: 'Spieler hat keine Rasse ausgewählt' };
            }

            // Bestätige die Rassenauswahl
            await db.query(
                'UPDATE game_players SET race_confirmed = 1 WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            console.log(`✓ Race selection confirmed for player ${playerName}`);

            // Prüfe ob alle Spieler ihre Rasse bestätigt haben
            const allPlayersReady = await this.checkAllPlayersReady(gameId);

            return {
                success: true,
                playerName: playerName,
                allReady: allPlayersReady
            };

        } catch (error) {
            console.error('Error confirming race:', error);
            return { success: false, message: 'Fehler bei der Rassenbestätigung: ' + error.message };
        }
    }

    // Spieler hebt seine Rassenauswahl auf (für "Rasse ändern")
    async deselectRace(gameId, playerName) {
        try {
            console.log(`Player ${playerName} deselecting race for game ${gameId}`);

            // Prüfe ob das Spiel in der Rassenauswahl-Phase ist
            const game = await db.query(
                'SELECT id, status FROM games WHERE id = ? AND status = "race_selection"',
                [gameId]
            );

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenauswahl-Phase' };
            }

            // Prüfe ob der Spieler existiert
            const player = await db.query(
                'SELECT id, player_name, race_id, race_confirmed FROM game_players WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            if (player.length === 0) {
                return { success: false, message: 'Spieler nicht in diesem Spiel gefunden' };
            }

            // Entferne die Rassenauswahl komplett
            await db.query(
                'UPDATE game_players SET race_id = NULL, race_confirmed = 0 WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            console.log(`✓ Race selection completely removed for player ${playerName}`);

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

    // Hole alle Rassenauswahlen für ein Spiel (für Updates)
    async getAllRaceSelections(gameId) {
        try {
            const selections = await db.query(`
                SELECT 
                    gp.player_name,
                    gp.race_id,
                    gp.race_confirmed,
                    r.name as race_name,
                    r.color_hex as race_color
                FROM game_players gp
                LEFT JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.is_active = 1
                ORDER BY gp.turn_order
            `, [gameId]);

            console.log(`Retrieved race selections for game ${gameId}:`, selections.map(s => ({
                player: s.player_name,
                race: s.race_name,
                confirmed: s.race_confirmed
            })));

            return { success: true, selections: selections };
        } catch (error) {
            console.error('Error getting race selections:', error);
            return { success: false, message: 'Fehler beim Abrufen der Rassenwahlen' };
        }
    }

    // Prüfe ob alle Spieler ihre Rasse bestätigt haben
    async checkAllPlayersReady(gameId) {
        try {
            // Zähle aktive Spieler
            const totalPlayers = await db.query(
                'SELECT COUNT(*) as count FROM game_players WHERE game_id = ? AND is_active = 1',
                [gameId]
            );

            // Zähle Spieler mit bestätigter Rasse
            const confirmedPlayers = await db.query(
                'SELECT COUNT(*) as count FROM game_players WHERE game_id = ? AND is_active = 1 AND race_confirmed = 1',
                [gameId]
            );

            const total = totalPlayers[0].count;
            const confirmed = confirmedPlayers[0].count;

            console.log(`Race selection progress: ${confirmed}/${total} players ready`);

            return confirmed === total && total > 0;

        } catch (error) {
            console.error('Error checking if all players ready:', error);
            return false;
        }
    }

    // Hole die Anzahl bereiter Spieler für UI-Updates
    async getReadyCount(gameId) {
        try {
            const totalPlayers = await db.query(
                'SELECT COUNT(*) as count FROM game_players WHERE game_id = ? AND is_active = 1',
                [gameId]
            );

            const confirmedPlayers = await db.query(
                'SELECT COUNT(*) as count FROM game_players WHERE game_id = ? AND is_active = 1 AND race_confirmed = 1',
                [gameId]
            );

            return {
                success: true,
                readyCount: confirmedPlayers[0].count,
                totalPlayers: totalPlayers[0].count
            };

        } catch (error) {
            console.error('Error getting ready count:', error);
            return { success: false, message: 'Fehler beim Abrufen der Spieleranzahl' };
        }
    }

    // Starte die Kartengenerierung nachdem alle Spieler bereit sind
    async startMapGeneration(gameId) {
        try {
            console.log(`Starting map generation for game ${gameId}`);

            // Prüfe nochmals ob alle Spieler bereit sind
            const allReady = await this.checkAllPlayersReady(gameId);
            if (!allReady) {
                return { success: false, message: 'Nicht alle Spieler haben ihre Rasse bestätigt' };
            }

            // Ändere Spielstatus zu "playing" (Kartengenerierung beginnt)
            await db.query(
                'UPDATE games SET status = "playing" WHERE id = ?',
                [gameId]
            );

            console.log(`✓ Game ${gameId} status changed to 'playing' - map generation can begin`);

            return { success: true };

        } catch (error) {
            console.error('Error starting map generation:', error);
            return { success: false, message: 'Fehler beim Starten der Kartengenerierung: ' + error.message };
        }
    }
}

module.exports = new RaceController();