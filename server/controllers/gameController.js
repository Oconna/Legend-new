const db = require('../config/database');
const MapGenerator = require('../models/Map');

class GameController {

    async startRaceSelection(gameId) {
        try {
            await db.query(
                'UPDATE games SET status = "race_selection" WHERE id = ?',
                [gameId]
            );
            return { success: true };
        } catch (error) {
            console.error('Error starting race selection:', error);
            return { success: false, message: 'Fehler beim Starten der Rassenwahl' };
        }
    }

    async selectRace(gameId, playerName, raceId) {
        try {
            // Prüfe ob die Rasse bereits von einem anderen Spieler gewählt wurde
            const existingRaceSelection = await db.query(
                'SELECT id FROM game_players WHERE game_id = ? AND race_id = ? AND player_name != ?',
                [gameId, raceId, playerName]
            );

            if (existingRaceSelection.length > 0) {
                return { success: false, message: 'Diese Rasse wurde bereits von einem anderen Spieler gewählt' };
            }

            // Prüfe ob die Rasse existiert
            const race = await db.query('SELECT name FROM races WHERE id = ?', [raceId]);
            if (race.length === 0) {
                return { success: false, message: 'Ungültige Rasse' };
            }

            // Update player race
            await db.query(
                'UPDATE game_players SET race_id = ? WHERE game_id = ? AND player_name = ?',
                [raceId, gameId, playerName]
            );

            // Prüfe ob alle Spieler eine Rasse gewählt haben
            const players = await db.query(
                'SELECT COUNT(*) as total, SUM(CASE WHEN race_id IS NOT NULL THEN 1 ELSE 0 END) as races_selected FROM game_players WHERE game_id = ? AND is_active = true',
                [gameId]
            );

            const allRacesSelected = players[0].races_selected === players[0].total;

            return {
                success: true,
                raceName: race[0].name,
                allRacesSelected: allRacesSelected
            };

        } catch (error) {
            console.error('Error selecting race:', error);
            return { success: false, message: 'Fehler bei der Rassenwahl' };
        }
    }

    async startGame(gameId) {
        try {
            // Get game and players data
            const game = await db.query('SELECT * FROM games WHERE id = ?', [gameId]);
            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden' };
            }

            const players = await db.query(`
                SELECT gp.*, r.name as race_name 
                FROM game_players gp 
                JOIN races r ON gp.race_id = r.id 
                WHERE gp.game_id = ? AND gp.is_active = true
                ORDER BY gp.joined_at
            `, [gameId]);

            // Generate turn order
            const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
            for (let i = 0; i < shuffledPlayers.length; i++) {
                await db.query(
                    'UPDATE game_players SET turn_order = ? WHERE id = ?',
                    [i + 1, shuffledPlayers[i].id]
                );
            }

            // Generate map
            const mapGenerator = new MapGenerator();
            await mapGenerator.generateMap(gameId, game[0].map_size, players);

            // Update game status
            await db.query(
                'UPDATE games SET status = "playing", started_at = NOW(), current_turn_player_id = ?, turn_number = 1 WHERE id = ?',
                [shuffledPlayers[0].id, gameId]
            );

            // Get complete game state
            const gameState = await this.getGameState(gameId);

            return {
                success: true,
                gameData: gameState
            };

        } catch (error) {
            console.error('Error starting game:', error);
            return { success: false, message: 'Fehler beim Spielstart' };
        }
    }

    async getGameState(gameId) {
        try {
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