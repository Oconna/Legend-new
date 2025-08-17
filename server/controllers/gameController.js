const db = require('../config/database');
const MapGenerator = require('../models/Map');

class GameController {

    async startRaceSelection(gameId) {
        try {
            console.log(`Starting race selection for game ${gameId}`);
            
            await db.query(
                'UPDATE games SET status = "race_selection" WHERE id = ?',
                [gameId]
            );
            
            console.log(`✓ Game ${gameId} status updated to race_selection`);
            return { success: true };
        } catch (error) {
            console.error('Error starting race selection:', error);
            return { success: false, message: 'Fehler beim Starten der Rassenwahl' };
        }
    }

    async selectRace(gameId, playerName, raceId, confirmed = false) {
        try {
            console.log(`Player ${playerName} ${confirmed ? 'confirming' : 'selecting'} race ${raceId} in game ${gameId}`);

            // Prüfe ob das Spiel existiert und in der richtigen Phase ist
            const game = await db.query(
                'SELECT id, status FROM games WHERE id = ? AND status = "race_selection"',
                [gameId]
            );

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenwahl-Phase' };
            }

            // Prüfe ob die Rasse existiert
            const race = await db.query('SELECT id, name FROM races WHERE id = ?', [raceId]);
            if (race.length === 0) {
                return { success: false, message: 'Ungültige Rasse' };
            }

            // Prüfe ob der Spieler existiert
            const player = await db.query(
                'SELECT id, player_name, race_id, race_confirmed FROM game_players WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            if (player.length === 0) {
                return { success: false, message: 'Spieler nicht in diesem Spiel gefunden' };
            }

            // Wenn Bestätigung: Prüfe ob bereits bestätigt
            if (confirmed && player[0].race_confirmed) {
                return { success: false, message: 'Du hast bereits eine Rasse bestätigt' };
            }

            // Wenn nur Auswahl: Erlaube Änderung auch wenn bereits eine Auswahl existiert (aber nicht bestätigt)
            if (!confirmed && player[0].race_confirmed) {
                return { success: false, message: 'Bestätigte Rassen können nicht mehr geändert werden' };
            }

            if (confirmed) {
                // Bei Bestätigung: Prüfe ob die Rasse bereits von einem anderen Spieler bestätigt wurde
                const existingConfirmedRace = await db.query(
                    'SELECT id, player_name FROM game_players WHERE game_id = ? AND race_id = ? AND player_name != ? AND race_confirmed = true',
                    [gameId, raceId, playerName]
                );

                if (existingConfirmedRace.length > 0) {
                    return { 
                        success: false, 
                        message: `Diese Rasse wurde bereits von ${existingConfirmedRace[0].player_name} bestätigt` 
                    };
                }

                // Speichere die bestätigte Rassenwahl in der Datenbank
                await db.query(
                    'UPDATE game_players SET race_id = ?, race_confirmed = true WHERE game_id = ? AND player_name = ?',
                    [raceId, gameId, playerName]
                );

                console.log(`✅ Race ${race[0].name} confirmed by player ${playerName}`);
            } else {
                // Nur Auswahl speichern (nicht bestätigt) - erlaube Überschreibung
                await db.query(
                    'UPDATE game_players SET race_id = ?, race_confirmed = false WHERE game_id = ? AND player_name = ?',
                    [raceId, gameId, playerName]
                );

                console.log(`🤔 Race ${race[0].name} selected (not confirmed) by player ${playerName}`);
            }

            // Prüfe Status der Rassenwahlen
            const raceSelectionStatus = await db.query(`
                SELECT 
                    COUNT(*) as total_players,
                    SUM(CASE WHEN race_id IS NOT NULL AND race_confirmed = true THEN 1 ELSE 0 END) as races_confirmed,
                    SUM(CASE WHEN race_id IS NOT NULL THEN 1 ELSE 0 END) as races_selected,
                    GROUP_CONCAT(
                        CONCAT(player_name, ':', COALESCE(race_id, 'null'), ':', COALESCE(race_confirmed, 'false')) 
                        SEPARATOR ', '
                    ) as player_status
                FROM game_players 
                WHERE game_id = ? AND is_active = true
            `, [gameId]);

            const status = raceSelectionStatus[0];
            const allRacesConfirmed = status.races_confirmed === status.total_players;

            console.log(`Race selection status for game ${gameId}:`, {
                totalPlayers: status.total_players,
                racesSelected: status.races_selected,
                racesConfirmed: status.races_confirmed,
                allRacesConfirmed: allRacesConfirmed,
                playerStatus: status.player_status
            });

            return {
                success: true,
                raceName: race[0].name,
                raceId: raceId,
                playerName: playerName,
                confirmed: confirmed,
                allRacesConfirmed: allRacesConfirmed,
                totalPlayers: status.total_players,
                racesSelected: status.races_selected,
                racesConfirmed: status.races_confirmed
            };

        } catch (error) {
            console.error('Error selecting race:', error);
            return { success: false, message: 'Fehler bei der Rassenwahl: ' + error.message };
        }
    }

    async deselectRace(gameId, playerName) {
        try {
            console.log(`Player ${playerName} deselecting race in game ${gameId}`);

            // Prüfe ob das Spiel existiert und in der richtigen Phase ist
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

            // Verhindere Deselection wenn bereits bestätigt
            if (player[0].race_confirmed) {
                return { success: false, message: 'Bestätigte Rassen können nicht mehr geändert werden' };
            }

            // Entferne die Rassenwahl
            await db.query(
                'UPDATE game_players SET race_id = NULL, race_confirmed = false WHERE game_id = ? AND player_name = ?',
                [gameId, playerName]
            );

            console.log(`✓ Race deselected for player ${playerName}`);

            return {
                success: true,
                playerName: playerName
            };

        } catch (error) {
            console.error('Error deselecting race:', error);
            return { success: false, message: 'Fehler bei der Rassenabwahl: ' + error.message };
        }
    }

    async getAllRaceSelections(gameId) {
        try {
            const selections = await db.query(`
                SELECT 
                    gp.player_name,
                    gp.race_id,
                    r.name as race_name,
                    r.color_hex as race_color
                FROM game_players gp
                LEFT JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.is_active = true
                ORDER BY gp.turn_order
            `, [gameId]);

            return { success: true, selections: selections };
        } catch (error) {
            console.error('Error getting race selections:', error);
            return { success: false, message: 'Fehler beim Abrufen der Rassenwahlen' };
        }
    }

    async startGame(gameId) {
        try {
            console.log(`Starting actual game for DB game ${gameId}`);

            // Get game and players data
            const game = await db.query('SELECT * FROM games WHERE id = ?', [gameId]);
            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden' };
            }

            // Prüfe ob alle Spieler eine Rasse gewählt haben
            const raceCheck = await db.query(`
                SELECT 
                    COUNT(*) as total_players,
                    SUM(CASE WHEN race_id IS NOT NULL THEN 1 ELSE 0 END) as races_selected
                FROM game_players 
                WHERE game_id = ? AND is_active = true
            `, [gameId]);

            if (raceCheck[0].races_selected !== raceCheck[0].total_players) {
                return { 
                    success: false, 
                    message: 'Nicht alle Spieler haben eine Rasse gewählt' 
                };
            }

            const players = await db.query(`
                SELECT gp.*, r.name as race_name, r.color_hex as race_color
                FROM game_players gp 
                JOIN races r ON gp.race_id = r.id 
                WHERE gp.game_id = ? AND gp.is_active = true
                ORDER BY gp.turn_order
            `, [gameId]);

            console.log(`Game ${gameId} has ${players.length} players with races selected`);

            // Generate map
            const mapGenerator = new MapGenerator();
            const mapResult = await mapGenerator.generateMap(gameId, game[0].map_size, players);

            if (!mapResult.success) {
                return { success: false, message: 'Fehler bei der Kartengenerierung' };
            }

            // Place starting units for each player
            await this.placeStartingUnits(gameId, players);

            // Update game status to playing and set first player
            const firstPlayer = players.find(p => p.turn_order === 1);
            await db.query(
                'UPDATE games SET status = "playing", started_at = NOW(), current_turn_player_id = ?, turn_number = 1 WHERE id = ?',
                [firstPlayer.id, gameId]
            );

            console.log(`✓ Game ${gameId} started successfully with first player: ${firstPlayer.player_name}`);

            // Get complete game state
            const gameState = await this.getGameState(gameId);

            return {
                success: true,
                gameData: gameState,
                message: 'Spiel erfolgreich gestartet!'
            };

        } catch (error) {
            console.error('Error starting game:', error);
            return { success: false, message: 'Fehler beim Spielstart: ' + error.message };
        }
    }

    async placeStartingUnits(gameId, players) {
        try {
            console.log(`Placing starting units for game ${gameId}`);

            for (const player of players) {
                // Find player's starting city
                const startingCity = await db.query(`
                    SELECT x_coordinate, y_coordinate 
                    FROM game_maps 
                    WHERE game_id = ? AND owner_player_id = ? AND building_type_id = 1
                    LIMIT 1
                `, [gameId, player.id]);

                if (startingCity.length === 0) {
                    console.warn(`No starting city found for player ${player.player_name}`);
                    continue;
                }

                // Get a basic unit for this race (first unit with lowest cost)
                const basicUnit = await db.query(`
                    SELECT id, name, cost, attack_power, health, movement_points
                    FROM units 
                    WHERE race_id = ? 
                    ORDER BY cost ASC 
                    LIMIT 1
                `, [player.race_id]);

                if (basicUnit.length === 0) {
                    console.warn(`No units found for race ${player.race_id}`);
                    continue;
                }

                const unit = basicUnit[0];

                // Find a free position around the starting city
                const freePosition = await this.findFreePositionNear(
                    gameId, 
                    startingCity[0].x_coordinate, 
                    startingCity[0].y_coordinate
                );

                if (freePosition) {
                    // Place starting unit
                    await db.query(`
                        INSERT INTO game_units (
                            game_id, player_id, unit_id, x_coordinate, y_coordinate, 
                            current_health, movement_points_left, has_attacked
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, false)
                    `, [
                        gameId, 
                        player.id, 
                        unit.id, 
                        freePosition.x, 
                        freePosition.y, 
                        unit.health, 
                        unit.movement_points
                    ]);

                    console.log(`✓ Starting unit ${unit.name} placed for ${player.player_name} at (${freePosition.x}, ${freePosition.y})`);
                } else {
                    console.warn(`Could not find free position for starting unit of player ${player.player_name}`);
                }
            }

        } catch (error) {
            console.error('Error placing starting units:', error);
            throw error;
        }
    }

    async findFreePositionNear(gameId, centerX, centerY, maxRadius = 3) {
        try {
            // Check positions in expanding circles around the center
            for (let radius = 1; radius <= maxRadius; radius++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        // Skip if not on the edge of current radius circle
                        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

                        const x = centerX + dx;
                        const y = centerY + dy;

                        // Check if position is valid (on map and not water)
                        const mapTile = await db.query(`
                            SELECT terrain_type_id 
                            FROM game_maps 
                            WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?
                        `, [gameId, x, y]);

                        if (mapTile.length === 0) continue; // Position not on map

                        // Skip water (terrain_type_id = 4)
                        if (mapTile[0].terrain_type_id === 4) continue;

                        // Check if position is free (no units)
                        const existingUnit = await db.query(`
                            SELECT id 
                            FROM game_units 
                            WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?
                        `, [gameId, x, y]);

                        if (existingUnit.length === 0) {
                            return { x: x, y: y };
                        }
                    }
                }
            }

            return null; // No free position found
        } catch (error) {
            console.error('Error finding free position:', error);
            return null;
        }
    }

    async getGameState(gameId) {
        try {
            console.log(`Getting game state for game ${gameId}`);

            // Get game info
            const game = await db.query('SELECT * FROM games WHERE id = ?', [gameId]);
            if (game.length === 0) {
                return null;
            }

            // Get players
            const players = await db.query(`
                SELECT 
                    gp.*,
                    r.name as race_name,
                    r.color_hex as race_color
                FROM game_players gp
                LEFT JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.is_active = true
                ORDER BY gp.turn_order
            `, [gameId]);

            // Get map
            const mapData = await db.query(`
                SELECT 
                    gm.*,
                    tt.name as terrain_name,
                    tt.color_hex as terrain_color,
                    tt.movement_cost,
                    bt.name as building_name,
                    bt.color_hex as building_color,
                    bt.gold_income,
                    gp.player_name as owner_name
                FROM game_maps gm
                JOIN terrain_types tt ON gm.terrain_type_id = tt.id
                LEFT JOIN building_types bt ON gm.building_type_id = bt.id
                LEFT JOIN game_players gp ON gm.owner_player_id = gp.id
                WHERE gm.game_id = ?
                ORDER BY gm.x_coordinate, gm.y_coordinate
            `, [gameId]);

            // Get units
            const units = await db.query(`
                SELECT 
                    gu.*,
                    u.name as unit_name,
                    u.attack_power,
                    u.health as max_health,
                    u.movement_points as max_movement_points,
                    u.attack_range,
                    gp.player_name as player_name,
                    r.color_hex as player_color
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                JOIN game_players gp ON gu.player_id = gp.id
                JOIN races r ON gp.race_id = r.id
                WHERE gu.game_id = ?
            `, [gameId]);

            console.log(`✓ Game state loaded: ${players.length} players, ${mapData.length} map tiles, ${units.length} units`);

            return {
                game: game[0],
                players: players,
                map: mapData,
                units: units
            };

        } catch (error) {
            console.error('Error getting game state:', error);
            return null;
        }
    }

    async executePlayerMove(gameId, playerId, fromX, fromY, toX, toY) {
        try {
            // Validate move (simplified for now)
            // TODO: Add proper movement validation, path finding, terrain costs etc.
            
            const unit = await db.query(
                'SELECT * FROM game_units WHERE game_id = ? AND player_id = ? AND x_coordinate = ? AND y_coordinate = ?',
                [gameId, playerId, fromX, fromY]
            );

            if (unit.length === 0) {
                return { success: false, message: 'Keine Einheit an der Position gefunden' };
            }

            // Check if target position is free
            const targetUnit = await db.query(
                'SELECT id FROM game_units WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?',
                [gameId, toX, toY]
            );

            if (targetUnit.length > 0) {
                return { success: false, message: 'Zielposition ist bereits besetzt' };
            }

            // Move unit
            await db.query(
                'UPDATE game_units SET x_coordinate = ?, y_coordinate = ?, movement_points_left = movement_points_left - 1 WHERE id = ?',
                [toX, toY, unit[0].id]
            );

            return { success: true };

        } catch (error) {
            console.error('Error executing player move:', error);
            return { success: false, message: 'Fehler bei der Bewegung' };
        }
    }
}

module.exports = new GameController();