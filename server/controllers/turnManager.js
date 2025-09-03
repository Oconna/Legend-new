// server/controllers/turnManager.js
// Verwaltet Züge, Aktionen und Spiellogik

const db = require('../config/database');

class TurnManager {
    constructor() {
        this.gameStates = new Map(); // Cached game states
    }

    // Neuen Zug starten (Gold vergeben, Einheiten zurücksetzen)
    async startTurn(gameId, playerId) {
        try {
            console.log(`🎯 Starting turn for player ${playerId} in game ${gameId}`);

            // Prüfe ob Spieler am Zug ist
            const game = await db.query(`
                SELECT current_turn_player_id, turn_number, map_size
                FROM games 
                WHERE id = ? AND status = 'playing'
            `, [gameId]);

            if (game.length === 0 || game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Gold basierend auf Städten/Burgen vergeben
            const goldIncome = await this.calculateGoldIncome(gameId, playerId);
            await db.query(`
                UPDATE game_players 
                SET gold = gold + ? 
                WHERE game_id = ? AND id = ?
            `, [goldIncome, gameId, playerId]);

            // Bewegungspunkte aller Einheiten des Spielers zurücksetzen
            await db.query(`
                UPDATE game_units gu
                JOIN units u ON gu.unit_id = u.id
                SET gu.movement_points_left = u.movement_points,
                    gu.has_attacked = 0
                WHERE gu.game_id = ? AND gu.player_id = ?
            `, [gameId, playerId]);

            console.log(`✅ Turn started - Player ${playerId} received ${goldIncome} gold`);

            return {
                success: true,
                goldIncome: goldIncome,
                message: `Du erhältst ${goldIncome} Gold zu Beginn deines Zuges`
            };

        } catch (error) {
            console.error('Error starting turn:', error);
            return { success: false, message: 'Fehler beim Zugbeginn' };
        }
    }

    // Gold-Einkommen basierend auf Städten/Burgen berechnen
    async calculateGoldIncome(gameId, playerId) {
        try {
            const buildings = await db.query(`
                SELECT SUM(bt.gold_income) as total_income
                FROM game_maps gm
                JOIN building_types bt ON gm.building_type_id = bt.id
                WHERE gm.game_id = ? AND gm.owner_player_id = ?
            `, [gameId, playerId]);

            return buildings[0]?.total_income || 0;

        } catch (error) {
            console.error('Error calculating gold income:', error);
            return 0;
        }
    }

    // Einheit kaufen
    async buyUnit(gameId, playerId, buildingX, buildingY, unitId) {
        try {
            console.log(`💰 Player ${playerId} buying unit ${unitId} at (${buildingX}, ${buildingY})`);

            // Prüfe ob Spieler am Zug ist
            const game = await db.query(`
                SELECT current_turn_player_id FROM games 
                WHERE id = ? AND status = 'playing'
            `, [gameId]);

            if (game.length === 0 || game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Prüfe ob Gebäude dem Spieler gehört
            const building = await db.query(`
                SELECT gm.*, bt.name as building_name
                FROM game_maps gm
                JOIN building_types bt ON gm.building_type_id = bt.id
                WHERE gm.game_id = ? AND gm.x_coordinate = ? AND gm.y_coordinate = ? 
                      AND gm.owner_player_id = ? AND gm.building_type_id IS NOT NULL
            `, [gameId, buildingX, buildingY, playerId]);

            if (building.length === 0) {
                return { success: false, message: 'Gebäude gehört dir nicht oder existiert nicht' };
            }

            // Prüfe ob Tile frei ist
            const existingUnit = await db.query(`
                SELECT id FROM game_units 
                WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?
            `, [gameId, buildingX, buildingY]);

            if (existingUnit.length > 0) {
                return { success: false, message: 'Auf dem Gebäude steht bereits eine Einheit' };
            }

            // Lade Einheitsdaten und Spielerrasse
            const unitData = await db.query(`
                SELECT u.*, gp.race_id, gp.gold, gp.player_level
                FROM units u, game_players gp
                WHERE u.id = ? AND gp.game_id = ? AND gp.id = ? AND u.race_id = gp.race_id
            `, [unitId, gameId, playerId]);

            if (unitData.length === 0) {
                return { success: false, message: 'Einheit nicht verfügbar für deine Rasse' };
            }

            const unit = unitData[0];
            const playerLevel = unit.player_level || 1;

            // Prüfe ob genug Gold vorhanden
            if (unit.gold < unit.cost) {
                return { success: false, message: 'Nicht genug Gold' };
            }

            // Berechne Einheiten-Stats basierend auf Spieler-Level
            const levelMultiplier = 1 + ((playerLevel - 1) * 0.2); // 20% pro Level
            const adjustedHealth = Math.floor(unit.health * levelMultiplier);
            const adjustedAttack = Math.floor(unit.attack_power * levelMultiplier);
            const adjustedRange = unit.attack_range + Math.floor((playerLevel - 1) * 0.5);

            // Gold abziehen
            await db.query(`
                UPDATE game_players 
                SET gold = gold - ? 
                WHERE game_id = ? AND id = ?
            `, [unit.cost, gameId, playerId]);

            // Einheit erstellen
            const result = await db.query(`
                INSERT INTO game_units (
                    game_id, player_id, unit_id, 
                    x_coordinate, y_coordinate, 
                    current_health, movement_points_left, 
                    has_attacked
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            `, [gameId, playerId, unitId, buildingX, buildingY, adjustedHealth, unit.movement_points]);

            console.log(`✅ Unit purchased - ${unit.name} for ${unit.cost} gold`);

            return {
                success: true,
                unitId: result.insertId,
                unitName: unit.name,
                cost: unit.cost,
                remainingGold: unit.gold - unit.cost,
                adjustedStats: {
                    health: adjustedHealth,
                    attack: adjustedAttack,
                    range: adjustedRange
                }
            };

        } catch (error) {
            console.error('Error buying unit:', error);
            return { success: false, message: 'Fehler beim Einheitenkauf' };
        }
    }

    // Einheit bewegen mit Pathfinding
    async moveUnit(gameId, playerId, unitId, targetX, targetY) {
        try {
            console.log(`🚶 Moving unit ${unitId} to (${targetX}, ${targetY})`);

            // Prüfe ob Spieler am Zug ist
            const game = await db.query(`
                SELECT current_turn_player_id FROM games 
                WHERE id = ? AND status = 'playing'
            `, [gameId]);

            if (game.length === 0 || game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Lade Einheit
            const unitResult = await db.query(`
                SELECT gu.*, u.movement_points, u.name as unit_name, u.can_fly
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                WHERE gu.id = ? AND gu.game_id = ? AND gu.player_id = ?
            `, [unitId, gameId, playerId]);

            if (unitResult.length === 0) {
                return { success: false, message: 'Einheit nicht gefunden' };
            }

            const unit = unitResult[0];

            // Prüfe Zielposition
            const targetTile = await db.query(`
                SELECT tt.movement_cost, tt.name as terrain_name
                FROM game_maps gm
                JOIN terrain_types tt ON gm.terrain_type_id = tt.id
                WHERE gm.game_id = ? AND gm.x_coordinate = ? AND gm.y_coordinate = ?
            `, [gameId, targetX, targetY]);

            if (targetTile.length === 0) {
                return { success: false, message: 'Ungültige Zielposition' };
            }

            // Prüfe ob Zielposition besetzt ist
            const occupiedTile = await db.query(`
                SELECT id FROM game_units 
                WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?
            `, [gameId, targetX, targetY]);

            if (occupiedTile.length > 0) {
                return { success: false, message: 'Zielposition ist besetzt' };
            }

            // Berechne Pfad und Bewegungskosten
            const pathResult = this.calculatePath(
                unit.x_coordinate, unit.y_coordinate,
                targetX, targetY,
                unit.can_fly || false
            );

            if (!pathResult.success) {
                return pathResult;
            }

            // Prüfe Bewegungspunkte
            const totalCost = pathResult.cost;
            if (totalCost > unit.movement_points_left) {
                return { 
                    success: false, 
                    message: `Nicht genug Bewegungspunkte (${totalCost} benötigt, ${unit.movement_points_left} verfügbar)` 
                };
            }

            // Einheit bewegen
            await db.query(`
                UPDATE game_units 
                SET x_coordinate = ?, y_coordinate = ?, movement_points_left = movement_points_left - ?
                WHERE id = ?
            `, [targetX, targetY, totalCost, unitId]);

            console.log(`✅ Unit moved - ${unit.unit_name} to (${targetX}, ${targetY}), cost: ${totalCost}`);

            return {
                success: true,
                fromX: unit.x_coordinate,
                fromY: unit.y_coordinate,
                toX: targetX,
                toY: targetY,
                movementCost: totalCost,
                remainingMovement: unit.movement_points_left - totalCost,
                path: pathResult.path
            };

        } catch (error) {
            console.error('Error moving unit:', error);
            return { success: false, message: 'Fehler bei der Bewegung' };
        }
    }

    // Einfache Pfadberechnung (Manhattan Distance)
    calculatePath(fromX, fromY, toX, toY, canFly = false) {
        const distance = Math.abs(toX - fromX) + Math.abs(toY - fromY);
        
        // Vereinfachte Pfadberechnung - bei fliegenden Einheiten niedriger Kostenfaktor
        const baseCost = canFly ? 1 : 1; // Kann später erweitert werden
        
        const path = [];
        let currentX = fromX;
        let currentY = fromY;

        // Einfacher Pfad - erst horizontal, dann vertikal
        while (currentX !== toX) {
            currentX += currentX < toX ? 1 : -1;
            path.push({ x: currentX, y: currentY });
        }
        
        while (currentY !== toY) {
            currentY += currentY < toY ? 1 : -1;
            path.push({ x: currentX, y: currentY });
        }

        return {
            success: true,
            cost: distance * baseCost,
            path: path
        };
    }

    // Angriff durchführen
    async attackUnit(gameId, playerId, attackerUnitId, targetX, targetY) {
        try {
            console.log(`⚔️ Unit ${attackerUnitId} attacking target at (${targetX}, ${targetY})`);

            // Prüfe ob Spieler am Zug ist
            const game = await db.query(`
                SELECT current_turn_player_id FROM games 
                WHERE id = ? AND status = 'playing'
            `, [gameId]);

            if (game.length === 0 || game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Lade Angreifer
            const attackerResult = await db.query(`
                SELECT gu.*, u.attack_power, u.attack_range, u.name as unit_name,
                       gm.terrain_type_id
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                JOIN game_maps gm ON gu.game_id = gm.game_id AND gu.x_coordinate = gm.x_coordinate AND gu.y_coordinate = gm.y_coordinate
                WHERE gu.id = ? AND gu.game_id = ? AND gu.player_id = ?
            `, [attackerUnitId, gameId, playerId]);

            if (attackerResult.length === 0) {
                return { success: false, message: 'Angreifende Einheit nicht gefunden' };
            }

            const attacker = attackerResult[0];

            // Prüfe ob bereits angegriffen
            if (attacker.has_attacked) {
                return { success: false, message: 'Einheit hat bereits angegriffen' };
            }

            // Lade Zieleinheit
            const targetResult = await db.query(`
                SELECT gu.*, u.name as unit_name, gp.player_name as target_player
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                JOIN game_players gp ON gu.player_id = gp.id
                WHERE gu.game_id = ? AND gu.x_coordinate = ? AND gu.y_coordinate = ?
                      AND gu.player_id != ?
            `, [gameId, targetX, targetY, playerId]);

            if (targetResult.length === 0) {
                return { success: false, message: 'Keine feindliche Einheit am Ziel gefunden' };
            }

            const target = targetResult[0];

            // Prüfe Reichweite
            const distance = Math.abs(targetX - attacker.x_coordinate) + Math.abs(targetY - attacker.y_coordinate);
            let effectiveRange = attacker.attack_range;

            // Berg-Bonus für Fernkampfeinheiten
            const terrainBonus = await db.query(`
                SELECT tt.name
                FROM terrain_types tt
                WHERE tt.id = ?
            `, [attacker.terrain_type_id]);

            if (terrainBonus.length > 0 && terrainBonus[0].name === 'Berg' && attacker.attack_range > 1) {
                effectiveRange += 1;
            }

            if (distance > effectiveRange) {
                return { success: false, message: 'Ziel außerhalb der Reichweite' };
            }

            // Schaden berechnen
            const damage = attacker.attack_power;
            const newHealth = target.current_health - damage;

            // Angriff als durchgeführt markieren
            await db.query(`
                UPDATE game_units 
                SET has_attacked = 1 
                WHERE id = ?
            `, [attackerUnitId]);

            let targetDestroyed = false;

            if (newHealth <= 0) {
                // Einheit vernichtet
                await db.query(`
                    DELETE FROM game_units 
                    WHERE id = ?
                `, [target.id]);
                targetDestroyed = true;
            } else {
                // Schaden anwenden
                await db.query(`
                    UPDATE game_units 
                    SET current_health = ? 
                    WHERE id = ?
                `, [newHealth, target.id]);
            }

            // Battle Log
            await db.query(`
                INSERT INTO battle_log (
                    game_id, attacker_unit_id, defender_unit_id, 
                    attacker_damage, turn_number, defender_survived
                ) VALUES (?, ?, ?, ?, 
                    (SELECT turn_number FROM games WHERE id = ?), 
                    ?)
            `, [gameId, attackerUnitId, target.id, damage, gameId, !targetDestroyed]);

            console.log(`✅ Attack completed - ${damage} damage dealt, target ${targetDestroyed ? 'destroyed' : 'survived'}`);

            return {
                success: true,
                damage: damage,
                targetDestroyed: targetDestroyed,
                targetNewHealth: targetDestroyed ? 0 : newHealth,
                attackerName: attacker.unit_name,
                targetName: target.unit_name,
                targetPlayer: target.target_player
            };

        } catch (error) {
            console.error('Error attacking unit:', error);
            return { success: false, message: 'Fehler beim Angriff' };
        }
    }

    // Spieler-Level erhöhen
    async upgradePlayerLevel(gameId, playerId) {
        try {
            console.log(`⬆️ Upgrading player level for player ${playerId}`);

            // Lade Spielerdaten
            const playerResult = await db.query(`
                SELECT gp.*, r.stufe_2, r.stufe_3
                FROM game_players gp
                JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.id = ?
            `, [gameId, playerId]);

            if (playerResult.length === 0) {
                return { success: false, message: 'Spieler nicht gefunden' };
            }

            const player = playerResult[0];
            const currentLevel = player.player_level || 1;

            if (currentLevel >= 3) {
                return { success: false, message: 'Maximales Level bereits erreicht' };
            }

            // Kosten bestimmen
            const upgradeCost = currentLevel === 1 ? player.stufe_2 : player.stufe_3;
            
            if (player.gold < upgradeCost) {
                return { success: false, message: 'Nicht genug Gold für Stufenaufstieg' };
            }

            // Level erhöhen und Gold abziehen
            await db.query(`
                UPDATE game_players 
                SET player_level = ?, gold = gold - ?
                WHERE game_id = ? AND id = ?
            `, [currentLevel + 1, upgradeCost, gameId, playerId]);

            console.log(`✅ Player leveled up to level ${currentLevel + 1} for ${upgradeCost} gold`);

            return {
                success: true,
                newLevel: currentLevel + 1,
                cost: upgradeCost,
                remainingGold: player.gold - upgradeCost
            };

        } catch (error) {
            console.error('Error upgrading player level:', error);
            return { success: false, message: 'Fehler beim Stufenaufstieg' };
        }
    }

    // Zug beenden
    async endTurn(gameId, playerId) {
        try {
            console.log(`🔄 Ending turn for player ${playerId} in game ${gameId}`);

            // Lade Spieldaten
            const game = await db.query(`
                SELECT current_turn_player_id, turn_number FROM games 
                WHERE id = ? AND status = 'playing'
            `, [gameId]);

            if (game.length === 0 || game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Lade alle aktiven Spieler
            const players = await db.query(`
                SELECT id, turn_order, player_name FROM game_players 
                WHERE game_id = ? AND is_active = 1 
                ORDER BY turn_order
            `, [gameId]);

            // Finde nächsten Spieler
            const currentPlayer = players.find(p => p.id === playerId);
            const nextPlayer = players.find(p => p.turn_order === currentPlayer.turn_order + 1) || players[0];
            
            let newTurnNumber = game[0].turn_number;
            if (nextPlayer.turn_order <= currentPlayer.turn_order) {
                newTurnNumber++; // Neue Runde beginnt
            }

            // Nächsten Spieler aktivieren
            await db.query(`
                UPDATE games 
                SET current_turn_player_id = ?, turn_number = ?
                WHERE id = ?
            `, [nextPlayer.id, newTurnNumber, gameId]);

            console.log(`✅ Turn ended - Next player: ${nextPlayer.player_name}, Turn: ${newTurnNumber}`);

            return {
                success: true,
                nextPlayerId: nextPlayer.id,
                nextPlayerName: nextPlayer.player_name,
                turnNumber: newTurnNumber
            };

        } catch (error) {
            console.error('Error ending turn:', error);
            return { success: false, message: 'Fehler beim Zugwechsel' };
        }
    }

    // Prüfe Spielende
    async checkGameEnd(gameId) {
        try {
            // Zähle aktive Spieler mit Einheiten oder Gebäuden
            const activePlayers = await db.query(`
                SELECT DISTINCT gp.id, gp.player_name
                FROM game_players gp
                WHERE gp.game_id = ? AND gp.is_active = 1
                  AND (
                    EXISTS (SELECT 1 FROM game_units gu WHERE gu.game_id = ? AND gu.player_id = gp.id) OR
                    EXISTS (SELECT 1 FROM game_maps gm WHERE gm.game_id = ? AND gm.owner_player_id = gp.id AND gm.building_type_id IS NOT NULL)
                  )
            `, [gameId, gameId, gameId]);

            if (activePlayers.length <= 1) {
                // Spiel beenden
                await db.query(`
                    UPDATE games 
                    SET status = 'finished', finished_at = NOW()
                    WHERE id = ?
                `, [gameId]);

                const winner = activePlayers.length === 1 ? activePlayers[0] : null;

                return {
                    gameEnded: true,
                    winner: winner
                };
            }

            return { gameEnded: false };

        } catch (error) {
            console.error('Error checking game end:', error);
            return { gameEnded: false };
        }
    }
}

module.exports = new TurnManager();