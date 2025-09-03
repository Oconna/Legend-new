// server/controllers/raceController.js - Verbesserte Fehlerbehandlung
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

            // ✅ VERBESSERTE DATENBANKABFRAGE mit Retry
            const game = await this.queryWithRetry(
                'SELECT id, status FROM games WHERE id = ? AND status = "race_selection"',
                [gameId],
                'check game status'
            );

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenauswahl-Phase' };
            }

            // Prüfe ob die Rasse existiert
            const race = await this.queryWithRetry(
                'SELECT id, name FROM races WHERE id = ?',
                [raceId],
                'check race exists'
            );

            if (race.length === 0) {
                return { success: false, message: 'Rasse nicht gefunden' };
            }

            // Prüfe ob Spieler existiert
            const player = await this.queryWithRetry(
                'SELECT id FROM game_players WHERE game_id = ? AND player_name = ? AND is_active = 1',
                [gameId, playerName],
                'check player exists'
            );

            if (player.length === 0) {
                return { success: false, message: 'Spieler nicht in diesem Spiel gefunden' };
            }

            // Prüfe ob Rasse bereits von anderem Spieler gewählt wurde
            const existingSelection = await this.queryWithRetry(`
                SELECT player_name FROM game_players 
                WHERE game_id = ? AND race_id = ? AND player_name != ? AND is_active = 1
            `, [gameId, raceId, playerName], 'check race availability');

            if (existingSelection.length > 0) {
                return { 
                    success: false, 
                    message: `Rasse bereits von ${existingSelection[0].player_name} gewählt` 
                };
            }

            // Rasse für Spieler setzen (noch nicht bestätigt)
            await this.queryWithRetry(`
                UPDATE game_players 
                SET race_id = ?, is_ready = 0 
                WHERE game_id = ? AND player_name = ?
            `, [raceId, gameId, playerName], 'select race');

            console.log(`✅ Race ${race[0].name} selected by ${playerName}`);

            return {
                success: true,
                race: race[0],
                message: `Rasse ${race[0].name} ausgewählt`
            };

        } catch (error) {
            console.error('Error selecting race:', error);
            return { success: false, message: 'Fehler bei der Rassenauswahl: ' + error.message };
        }
    }

    // Spieler bestätigt seine Rassenwahl
    async confirmRaceSelection(gameId, playerName, raceId) {
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                console.log(`Confirming race selection: ${playerName} -> Race ${raceId} in game ${gameId}`);

                // ✅ TRANSACTION für Atomicity
                const result = await db.transaction(async (connection) => {
                    // Spiel-Status prüfen
                    const [gameRows] = await connection.execute(
                        'SELECT id, status FROM games WHERE id = ? AND status = "race_selection"',
                        [gameId]
                    );

                    if (gameRows.length === 0) {
                        throw new Error('Spiel nicht gefunden oder nicht in Rassenauswahl-Phase');
                    }

                    // Rasse und Spieler prüfen
                    const [raceRows] = await connection.execute(
                        'SELECT id, name FROM races WHERE id = ?',
                        [raceId]
                    );

                    if (raceRows.length === 0) {
                        throw new Error('Rasse nicht gefunden');
                    }

                    const [playerRows] = await connection.execute(
                        'SELECT id, race_id FROM game_players WHERE game_id = ? AND player_name = ? AND is_active = 1',
                        [gameId, playerName]
                    );

                    if (playerRows.length === 0) {
                        throw new Error('Spieler nicht in diesem Spiel gefunden');
                    }

                    const player = playerRows[0];

                    // Prüfe ob Rasse immer noch verfügbar ist
                    const [conflictRows] = await connection.execute(`
                        SELECT player_name FROM game_players 
                        WHERE game_id = ? AND race_id = ? AND player_name != ? AND is_active = 1 AND is_ready = 1
                    `, [gameId, raceId, playerName]);

                    if (conflictRows.length > 0) {
                        throw new Error(`Rasse bereits von ${conflictRows[0].player_name} bestätigt`);
                    }

                    // Rassenwahl bestätigen
                    const [updateResult] = await connection.execute(`
                        UPDATE game_players 
                        SET race_id = ?, is_ready = 1 
                        WHERE game_id = ? AND player_name = ? AND is_active = 1
                    `, [raceId, gameId, playerName]);

                    if (updateResult.affectedRows === 0) {
                        throw new Error('Fehler beim Bestätigen der Rassenwahl');
                    }

                    // Alle Spieler laden um zu prüfen ob alle bereit sind
                    const [allPlayersRows] = await connection.execute(`
                        SELECT id, player_name, race_id, is_ready 
                        FROM game_players 
                        WHERE game_id = ? AND is_active = 1 
                        ORDER BY joined_at
                    `, [gameId]);

                    return {
                        race: raceRows[0],
                        allPlayers: allPlayersRows,
                        playerId: player.id
                    };
                });

                // Prüfe ob alle Spieler bereit sind
                const allReady = result.allPlayers.every(p => p.is_ready && p.race_id);
                const confirmedCount = result.allPlayers.filter(p => p.is_ready && p.race_id).length;

                console.log(`✅ Race confirmed for ${playerName}. Ready players: ${confirmedCount}/${result.allPlayers.length}`);

                return {
                    success: true,
                    race: result.race,
                    allReady: allReady,
                    confirmedPlayers: confirmedCount,
                    totalPlayers: result.allPlayers.length,
                    players: result.allPlayers,
                    message: `Rasse ${result.race.name} bestätigt`
                };

            } catch (error) {
                retryCount++;
                console.error(`Error confirming race selection (attempt ${retryCount}/${maxRetries}):`, error);
                
                if (this.isRetryableError(error) && retryCount < maxRetries) {
                    console.log(`🔄 Retrying race confirmation in ${1000 * retryCount}ms...`);
                    await this.sleep(1000 * retryCount);
                    continue;
                }
                
                return { 
                    success: false, 
                    message: 'Fehler beim Bestätigen der Rassenwahl: ' + error.message 
                };
            }
        }
    }

    // Spieler macht Rassenwahl rückgängig
    async deselectRace(gameId, playerName) {
        try {
            console.log(`Player ${playerName} deselecting race in game ${gameId}`);

            const result = await this.queryWithRetry(`
                UPDATE game_players 
                SET race_id = NULL, is_ready = 0 
                WHERE game_id = ? AND player_name = ? AND is_active = 1
            `, [gameId, playerName], 'deselect race');

            if (result.affectedRows === 0) {
                return { success: false, message: 'Spieler nicht gefunden oder bereits keine Rasse gewählt' };
            }

            console.log(`✅ Race deselected for ${playerName}`);

            return {
                success: true,
                message: 'Rassenwahl zurückgenommen'
            };

        } catch (error) {
            console.error('Error deselecting race:', error);
            return { success: false, message: 'Fehler beim Zurücknehmen der Rassenwahl: ' + error.message };
        }
    }

    // Aktuelle Rassenwahlen für ein Spiel abrufen
    async getRaceSelections(gameId) {
        try {
            console.log(`Getting race selections for game ${gameId}`);

            const selections = await this.queryWithRetry(`
                SELECT 
                    gp.id,
                    gp.player_name,
                    gp.race_id,
                    gp.is_ready,
                    r.name as race_name,
                    r.color_hex as race_color,
                    r.description as race_description
                FROM game_players gp
                LEFT JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.is_active = 1
                ORDER BY gp.joined_at
            `, [gameId], 'get race selections');

            console.log(`Found ${selections.length} players in game ${gameId}`);

            return {
                success: true,
                selections: selections
            };

        } catch (error) {
            console.error('Error getting race selections:', error);
            return { success: false, message: 'Fehler beim Laden der Rassenwahlen: ' + error.message };
        }
    }

    // ✅ HILFSMETHODEN FÜR RETRY-LOGIK

    async queryWithRetry(sql, params, operation) {
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                return await db.query(sql, params);
            } catch (error) {
                retryCount++;
                console.error(`Database error during ${operation} (attempt ${retryCount}/${maxRetries}):`, error);
                
                if (this.isRetryableError(error) && retryCount < maxRetries) {
                    const delay = 1000 * retryCount; // Exponential backoff
                    console.log(`🔄 Retrying ${operation} in ${delay}ms...`);
                    await this.sleep(delay);
                    continue;
                }
                
                throw error;
            }
        }
    }

    isRetryableError(error) {
        const retryableCodes = [
            'ECONNRESET',
            'PROTOCOL_CONNECTION_LOST', 
            'ETIMEDOUT',
            'ENOTFOUND',
            'ER_LOCK_WAIT_TIMEOUT'
        ];
        
        return retryableCodes.includes(error.code) || error.message.includes('ECONNRESET');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ✅ BATCH-OPERATIONEN FÜR BESSERE PERFORMANCE

    async batchUpdateRaceSelections(gameId, selections) {
        try {
            const updatePromises = selections.map(selection => 
                this.queryWithRetry(`
                    UPDATE game_players 
                    SET race_id = ?, is_ready = ? 
                    WHERE game_id = ? AND player_name = ? AND is_active = 1
                `, [selection.raceId, selection.isReady, gameId, selection.playerName], 
                `batch update for ${selection.playerName}`)
            );

            await Promise.all(updatePromises);
            return { success: true };

        } catch (error) {
            console.error('Error in batch race selection update:', error);
            return { success: false, message: error.message };
        }
    }

    // ✅ VALIDATION HELPERS

    validateRaceSelection(gameId, playerName, raceId) {
        if (!gameId || !playerName || !raceId) {
            return { valid: false, message: 'Fehlende erforderliche Parameter' };
        }

        if (typeof gameId !== 'string' && typeof gameId !== 'number') {
            return { valid: false, message: 'Ungültige Spiel-ID' };
        }

        if (typeof playerName !== 'string' || playerName.trim().length === 0) {
            return { valid: false, message: 'Ungültiger Spielername' };
        }

        if (typeof raceId !== 'string' && typeof raceId !== 'number') {
            return { valid: false, message: 'Ungültige Rassen-ID' };
        }

        return { valid: true };
    }
}

module.exports = new RaceController();