// server/controllers/gameEngine.js
// Hauptspiel-Engine für das Strategiespiel

const db = require('../config/database');

class GameEngine {
    constructor() {
        this.activeGames = new Map(); // gameId -> gameState cache
    }

    // Laden des kompletten Spielzustands
    async loadGameState(gameId) {
        try {
            console.log(`Loading game state for game ${gameId}`);
            
            // Spiel-Grundinformationen
            const game = await db.query('SELECT * FROM games WHERE id = ? AND status = "playing"', [gameId]);
            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht im Spielmodus' };
            }

            // Spieler
            const players = await db.query(`
                SELECT 
                    gp.*,
                    r.name as race_name,
                    r.color_hex as race_color
                FROM game_players gp
                JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.is_active = 1
                ORDER BY gp.turn_order
            `, [gameId]);

            // Kartendaten
            const mapData = await db.query(`
                SELECT 
                    gm.*,
                    tt.name as terrain_name,
                    tt.color_hex as terrain_color,
                    tt.movement_cost,
                    bt.name as building_name,
                    bt.color_hex as building_color,
                    bt.gold_income,
                    bt.max_health as building_max_health,
                    gp.player_name as owner_name,
                    gp.race_id as owner_race_id
                FROM game_maps gm
                JOIN terrain_types tt ON gm.terrain_type_id = tt.id
                LEFT JOIN building_types bt ON gm.building_type_id = bt.id
                LEFT JOIN game_players gp ON gm.owner_player_id = gp.id
                WHERE gm.game_id = ?
                ORDER BY gm.x_coordinate, gm.y_coordinate
            `, [gameId]);

            // Einheiten auf der Karte
            const units = await db.query(`
                SELECT 
                    gu.*,
                    u.name as unit_name,
                    u.attack_power,
                    u.health as max_health,
                    u.movement_points as max_movement_points,
                    u.attack_range,
                    u.cost,
                    gp.player_name as player_name,
                    r.color_hex as player_color
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                JOIN game_players gp ON gu.player_id = gp.id
                JOIN races r ON gp.race_id = r.id
                WHERE gu.game_id = ?
            `, [gameId]);

            // Verfügbare Einheiten pro Rasse (für Einheitenkauf)
            const availableUnits = await db.query(`
                SELECT DISTINCT
                    u.*,
                    r.name as race_name
                FROM units u
                JOIN races r ON u.race_id = r.id
                WHERE u.race_id IN (
                    SELECT DISTINCT race_id FROM game_players WHERE game_id = ? AND is_active = 1
                )
                ORDER BY u.race_id, u.cost
            `, [gameId]);

            const gameState = {
                game: game[0],
                players: players,
                map: mapData,
                units: units,
                availableUnits: availableUnits,
                mapSize: game[0].map_size,
                currentTurn: game[0].turn_number,
                currentPlayerId: game[0].current_turn_player_id
            };

            // Cache für bessere Performance
            this.activeGames.set(gameId, gameState);

            return { success: true, gameState: gameState };

        } catch (error) {
            console.error('Error loading game state:', error);
            return { success: false, message: 'Fehler beim Laden des Spielzustands' };
        }
    }

    // Zug beenden und nächsten Spieler aktivieren
    async endTurn(gameId, playerId) {
        try {
            console.log(`Ending turn for player ${playerId} in game ${gameId}`);

            // Lade aktuellen Spielzustand
            const gameState = await this.loadGameState(gameId);
            if (!gameState.success) {
                return gameState;
            }

            const game = gameState.gameState.game;
            const players = gameState.gameState.players;

            // Prüfe ob der richtige Spieler am Zug ist
            if (game.current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Finde nächsten Spieler
            const currentPlayer = players.find(p => p.id === playerId);
            const currentTurnOrder = currentPlayer.turn_order;
            
            let nextPlayer = players.find(p => p.turn_order === currentTurnOrder + 1);
            let newTurnNumber = game.turn_number;

            // Wenn kein nächster Spieler, beginne neue Runde
            if (!nextPlayer) {
                nextPlayer = players.find(p => p.turn_order === 1);
                newTurnNumber++;
            }

            // Bewegungspunkte aller Einheiten des aktuellen Spielers zurücksetzen
            await db.query(`
                UPDATE game_units gu
                JOIN units u ON gu.unit_id = u.id
                SET gu.movement_points_left = u.movement_points,
                    gu.has_attacked = 0
                WHERE gu.game_id = ? AND gu.player_id = ?
            `, [gameId, playerId]);

            // Gold für alle Spieler am Rundenbeginn berechnen (nur bei Rundenwechsel)
            if (nextPlayer.turn_order === 1) {
                await this.calculateIncomeForAllPlayers(gameId);
            }

            // Nächsten Spieler aktivieren
            await db.query(`
                UPDATE games 
                SET current_turn_player_id = ?, turn_number = ?
                WHERE id = ?
            `, [nextPlayer.id, newTurnNumber, gameId]);

            // Cache invalidieren
            this.activeGames.delete(gameId);

            return {
                success: true,
                nextPlayer: {
                    id: nextPlayer.id,
                    name: nextPlayer.player_name,
                    turnOrder: nextPlayer.turn_order
                },
                turnNumber: newTurnNumber,
                isNewRound: nextPlayer.turn_order === 1
            };

        } catch (error) {
            console.error('Error ending turn:', error);
            return { success: false, message: 'Fehler beim Beenden des Zuges' };
        }
    }

    // Gold-Einkommen für alle Spieler berechnen (Rundenbeginn)
    async calculateIncomeForAllPlayers(gameId) {
        try {
            console.log(`Calculating income for all players in game ${gameId}`);

            // Hole alle aktiven Spieler
            const players = await db.query(`
                SELECT id, player_name, gold 
                FROM game_players 
                WHERE game_id = ? AND is_active = 1
            `, [gameId]);

            for (const player of players) {
                // Berechne Einkommen aus Gebäuden
                const income = await db.query(`
                    SELECT COALESCE(SUM(bt.gold_income), 0) as total_income
                    FROM game_maps gm
                    JOIN building_types bt ON gm.building_type_id = bt.id
                    WHERE gm.game_id = ? AND gm.owner_player_id = ?
                `, [gameId, player.id]);

                const goldIncome = income[0].total_income;
                const newGold = player.gold + goldIncome;

                // Gold aktualisieren
                await db.query(`
                    UPDATE game_players 
                    SET gold = ? 
                    WHERE id = ?
                `, [newGold, player.id]);

                console.log(`Player ${player.player_name} earned ${goldIncome} gold (${player.gold} -> ${newGold})`);
            }

        } catch (error) {
            console.error('Error calculating income:', error);
            throw error;
        }
    }

    // Einheit bewegen
    async moveUnit(gameId, playerId, unitId, targetX, targetY) {
        try {
            console.log(`Moving unit ${unitId} to (${targetX}, ${targetY}) for player ${playerId}`);

            // Prüfe ob Spieler am Zug ist
            const gameState = await this.loadGameState(gameId);
            if (!gameState.success) return gameState;

            if (gameState.gameState.game.current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Lade Einheit
            const unit = await db.query(`
                SELECT gu.*, u.movement_points, u.name as unit_name
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                WHERE gu.id = ? AND gu.game_id = ? AND gu.player_id = ?
            `, [unitId, gameId, playerId]);

            if (unit.length === 0) {
                return { success: false, message: 'Einheit nicht gefunden' };
            }

            const unitData = unit[0];

            // Prüfe ob Einheit noch Bewegungspunkte hat
            if (unitData.movement_points_left <= 0) {
                return { success: false, message: 'Einheit hat keine Bewegungspunkte mehr' };
            }

            // Prüfe ob Zielposition gültig ist
            const targetTile = await db.query(`
                SELECT gm.*, tt.movement_cost
                FROM game_maps gm
                JOIN terrain_types tt ON gm.terrain_type_id = tt.id
                WHERE gm.game_id = ? AND gm.x_coordinate = ? AND gm.y_coordinate = ?
            `, [gameId, targetX, targetY]);

            if (targetTile.length === 0) {
                return { success: false, message: 'Ungültige Zielposition' };
            }

            // Prüfe ob Zielposition frei ist
            const occupiedByUnit = await db.query(`
                SELECT id FROM game_units 
                WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ? AND id != ?
            `, [gameId, targetX, targetY, unitId]);

            if (occupiedByUnit.length > 0) {
                return { success: false, message: 'Zielposition ist bereits besetzt' };
            }

            // Berechne Bewegungskosten
            const distance = Math.abs(targetX - unitData.x_coordinate) + Math.abs(targetY - unitData.y_coordinate);
            const movementCost = targetTile[0].movement_cost * distance;

            if (movementCost > unitData.movement_points_left) {
                return { success: false, message: 'Nicht genug Bewegungspunkte' };
            }

            // Bewege Einheit
            await db.query(`
                UPDATE game_units 
                SET x_coordinate = ?, y_coordinate = ?, movement_points_left = movement_points_left - ?
                WHERE id = ?
            `, [targetX, targetY, movementCost, unitId]);

            // Cache invalidieren
            this.activeGames.delete(gameId);

            return {
                success: true,
                unitId: unitId,
                fromX: unitData.x_coordinate,
                fromY: unitData.y_coordinate,
                toX: targetX,
                toY: targetY,
                movementCost: movementCost,
                remainingMovement: unitData.movement_points_left - movementCost
            };

        } catch (error) {
            console.error('Error moving unit:', error);
            return { success: false, message: 'Fehler bei der Bewegung' };
        }
    }

    // Angriff ausführen
    async attackUnit(gameId, playerId, attackerUnitId, targetX, targetY) {
        try {
            console.log(`Unit ${attackerUnitId} attacking target at (${targetX}, ${targetY})`);

            // Prüfe ob Spieler am Zug ist
            const gameState = await this.loadGameState(gameId);
            if (!gameState.success) return gameState;

            if (gameState.gameState.game.current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Lade angreifende Einheit
            const attacker = await db.query(`
                SELECT gu.*, u.attack_power, u.attack_range, u.name as unit_name
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                WHERE gu.id = ? AND gu.game_id = ? AND gu.player_id = ?
            `, [attackerUnitId, gameId, playerId]);

            if (attacker.length === 0) {
                return { success: false, message: 'Angreifende Einheit nicht gefunden' };
            }

            const attackerData = attacker[0];

            // Prüfe ob Einheit bereits angegriffen hat
            if (attackerData.has_attacked) {
                return { success: false, message: 'Einheit hat bereits angegriffen' };
            }

            // Prüfe Reichweite
            const distance = Math.abs(targetX - attackerData.x_coordinate) + Math.abs(targetY - attackerData.y_coordinate);
            if (distance > attackerData.attack_range) {
                return { success: false, message: 'Ziel außerhalb der Reichweite' };
            }

            // Lade Ziel-Einheit
            const defender = await db.query(`
                SELECT gu.*, u.attack_power, u.name as unit_name, gp.player_name as owner_name
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                JOIN game_players gp ON gu.player_id = gp.id
                WHERE gu.game_id = ? AND gu.x_coordinate = ? AND gu.y_coordinate = ?
            `, [gameId, targetX, targetY]);

            if (defender.length === 0) {
                return { success: false, message: 'Keine Einheit am Zielort gefunden' };
            }

            const defenderData = defender[0];

            // Prüfe dass es nicht die eigene Einheit ist
            if (defenderData.player_id === playerId) {
                return { success: false, message: 'Du kannst deine eigenen Einheiten nicht angreifen' };
            }

            // Berechne Schaden
            const attackerDamage = this.calculateDamage(attackerData.attack_power);
            const defenderDamage = this.calculateDamage(defenderData.attack_power);

            // Führe Angriff aus
            const defenderNewHealth = Math.max(0, defenderData.current_health - attackerDamage);
            const attackerNewHealth = Math.max(0, attackerData.current_health - defenderDamage);

            const defenderDestroyed = defenderNewHealth <= 0;
            const attackerDestroyed = attackerNewHealth <= 0;

            // Aktualisiere Einheiten in Datenbank
            if (defenderDestroyed) {
                await db.query('DELETE FROM game_units WHERE id = ?', [defenderData.id]);
            } else {
                await db.query('UPDATE game_units SET current_health = ? WHERE id = ?', 
                    [defenderNewHealth, defenderData.id]);
            }

            if (attackerDestroyed) {
                await db.query('DELETE FROM game_units WHERE id = ?', [attackerData.id]);
            } else {
                await db.query('UPDATE game_units SET current_health = ?, has_attacked = 1 WHERE id = ?', 
                    [attackerNewHealth, attackerData.id]);
            }

            // Speichere Kampflog
            await db.query(`
                INSERT INTO battle_log 
                (game_id, attacker_unit_id, defender_unit_id, attacker_damage, defender_damage, 
                 attacker_survived, defender_survived, turn_number)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                gameId, attackerData.id, defenderData.id, attackerDamage, defenderDamage,
                !attackerDestroyed, !defenderDestroyed, gameState.gameState.game.turn_number
            ]);

            // Cache invalidieren
            this.activeGames.delete(gameId);

            return {
                success: true,
                attacker: {
                    id: attackerData.id,
                    name: attackerData.unit_name,
                    damage: attackerDamage,
                    newHealth: attackerNewHealth,
                    destroyed: attackerDestroyed
                },
                defender: {
                    id: defenderData.id,
                    name: defenderData.unit_name,
                    owner: defenderData.owner_name,
                    damage: defenderDamage,
                    newHealth: defenderNewHealth,
                    destroyed: defenderDestroyed
                }
            };

        } catch (error) {
            console.error('Error in attack:', error);
            return { success: false, message: 'Fehler beim Angriff' };
        }
    }

    // Einheit kaufen
    async purchaseUnit(gameId, playerId, unitTypeId, buildingX, buildingY) {
        try {
            console.log(`Player ${playerId} purchasing unit ${unitTypeId} at (${buildingX}, ${buildingY})`);

            // Prüfe ob Spieler am Zug ist
            const gameState = await this.loadGameState(gameId);
            if (!gameState.success) return gameState;

            if (gameState.gameState.game.current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Prüfe ob Gebäude dem Spieler gehört
            const building = await db.query(`
                SELECT * FROM game_maps 
                WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ? 
                AND owner_player_id = ? AND building_type_id IS NOT NULL
            `, [gameId, buildingX, buildingY, playerId]);

            if (building.length === 0) {
                return { success: false, message: 'Kein Gebäude oder nicht dein Besitz' };
            }

            // Prüfe ob Position frei ist
            const occupiedByUnit = await db.query(`
                SELECT id FROM game_units 
                WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?
            `, [gameId, buildingX, buildingY]);

            if (occupiedByUnit.length > 0) {
                return { success: false, message: 'Position ist bereits besetzt' };
            }

            // Lade Einheitentyp und Spielerinfo
            const unitType = await db.query(`
                SELECT u.*, r.name as race_name
                FROM units u
                JOIN races r ON u.race_id = r.id
                WHERE u.id = ?
            `, [unitTypeId]);

            if (unitType.length === 0) {
                return { success: false, message: 'Einheitentyp nicht gefunden' };
            }

            const player = await db.query(`
                SELECT * FROM game_players 
                WHERE id = ? AND game_id = ?
            `, [playerId, gameId]);

            if (player.length === 0) {
                return { success: false, message: 'Spieler nicht gefunden' };
            }

            const unitData = unitType[0];
            const playerData = player[0];

            // Prüfe ob Spieler genug Gold hat
            if (playerData.gold < unitData.cost) {
                return { success: false, message: 'Nicht genug Gold' };
            }

            // Prüfe ob Einheit zur Spielerrasse gehört
            if (unitData.race_id !== playerData.race_id) {
                return { success: false, message: 'Einheit gehört nicht zu deiner Rasse' };
            }

            // Kaufe Einheit
            await db.query(`
                INSERT INTO game_units 
                (game_id, player_id, unit_id, x_coordinate, y_coordinate, current_health, movement_points_left, has_attacked)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            `, [gameId, playerId, unitTypeId, buildingX, buildingY, unitData.health, unitData.movement_points]);

            // Reduziere Gold
            await db.query(`
                UPDATE game_players 
                SET gold = gold - ? 
                WHERE id = ?
            `, [unitData.cost, playerId]);

            // Cache invalidieren
            this.activeGames.delete(gameId);

            return {
                success: true,
                unit: {
                    name: unitData.name,
                    cost: unitData.cost,
                    x: buildingX,
                    y: buildingY
                },
                newGold: playerData.gold - unitData.cost
            };

        } catch (error) {
            console.error('Error purchasing unit:', error);
            return { success: false, message: 'Fehler beim Einheitenkauf' };
        }
    }

    // Schadenberechnung mit Zufallselement
    calculateDamage(baseDamage) {
        // 80-120% des Grundschadens
        const variance = 0.2;
        const multiplier = 1 + (Math.random() * 2 - 1) * variance;
        return Math.round(baseDamage * multiplier);
    }

    // Spielende prüfen
    async checkGameEnd(gameId) {
        try {
            // Prüfe für jeden Spieler ob er noch Einheiten oder Gebäude hat
            const playerStatus = await db.query(`
                SELECT 
                    gp.id,
                    gp.player_name,
                    COUNT(DISTINCT gu.id) as unit_count,
                    COUNT(DISTINCT gm.id) as building_count
                FROM game_players gp
                LEFT JOIN game_units gu ON gp.id = gu.player_id AND gu.game_id = ?
                LEFT JOIN game_maps gm ON gp.id = gm.owner_player_id AND gm.game_id = ? AND gm.building_type_id IS NOT NULL
                WHERE gp.game_id = ? AND gp.is_active = 1
                GROUP BY gp.id, gp.player_name
            `, [gameId, gameId, gameId]);

            const alivePlayers = playerStatus.filter(p => p.unit_count > 0 || p.building_count > 0);
            const eliminatedPlayers = playerStatus.filter(p => p.unit_count === 0 && p.building_count === 0);

            // Eliminierte Spieler als inaktiv markieren
            for (const player of eliminatedPlayers) {
                await db.query(`
                    UPDATE game_players 
                    SET is_active = 0 
                    WHERE id = ?
                `, [player.id]);
            }

            // Prüfe Spielende
            if (alivePlayers.length <= 1) {
                const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
                
                await db.query(`
                    UPDATE games 
                    SET status = 'finished', finished_at = NOW()
                    WHERE id = ?
                `, [gameId]);

                return {
                    gameEnded: true,
                    winner: winner,
                    eliminatedPlayers: eliminatedPlayers
                };
            }

            return {
                gameEnded: false,
                eliminatedPlayers: eliminatedPlayers
            };

        } catch (error) {
            console.error('Error checking game end:', error);
            return { gameEnded: false, eliminatedPlayers: [] };
        }
    }

    // Gebäude erobern (wenn Einheit darauf steht)
    async captureBuilding(gameId, playerId, x, y) {
        try {
            // Prüfe ob dort ein Gebäude ist
            const building = await db.query(`
                SELECT * FROM game_maps 
                WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ? 
                AND building_type_id IS NOT NULL
            `, [gameId, x, y]);

            if (building.length === 0) {
                return { success: false, message: 'Kein Gebäude an dieser Position' };
            }

            // Prüfe ob dort eine Einheit des Spielers steht
            const unit = await db.query(`
                SELECT * FROM game_units 
                WHERE game_id = ? AND player_id = ? AND x_coordinate = ? AND y_coordinate = ?
            `, [gameId, playerId, x, y]);

            if (unit.length === 0) {
                return { success: false, message: 'Keine deiner Einheiten an dieser Position' };
            }

            const buildingData = building[0];
            
            // Erobere Gebäude nur wenn es nicht bereits dem Spieler gehört
            if (buildingData.owner_player_id !== playerId) {
                await db.query(`
                    UPDATE game_maps 
                    SET owner_player_id = ? 
                    WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?
                `, [playerId, gameId, x, y]);

                // Cache invalidieren
                this.activeGames.delete(gameId);

                return {
                    success: true,
                    captured: true,
                    buildingType: buildingData.building_type_id
                };
            }

            return { success: true, captured: false };

        } catch (error) {
            console.error('Error capturing building:', error);
            return { success: false, message: 'Fehler beim Erobern des Gebäudes' };
        }
    }
}

module.exports = new GameEngine();