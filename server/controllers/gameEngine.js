// server/controllers/gameEngine.js
// Hauptspiel-Engine für das Strategiespiel

const db = require('../config/database');

class GameEngine {
    constructor() {
        this.activeGames = new Map(); // gameId -> gameState cache
    }

    async startGame(gameId) {
        try {
            console.log(`🎮 Starting game ${gameId}`);
            
            // Spielstatus auf "playing" setzen
            await db.query('UPDATE games SET status = "playing", started_at = NOW() WHERE id = ?', [gameId]);
            
            // Spieler-Reihenfolge zufällig festlegen
            const players = await db.query('SELECT * FROM game_players WHERE game_id = ? ORDER BY joined_at', [gameId]);
            const shuffledPlayers = this.shuffleArray([...players]);
            
            for (let i = 0; i < shuffledPlayers.length; i++) {
                await db.query('UPDATE game_players SET turn_order = ? WHERE id = ?', [i, shuffledPlayers[i].id]);
            }
            
            // Ersten Spieler als aktuellen Spieler setzen
            const firstPlayer = shuffledPlayers[0];
            await db.query('UPDATE games SET current_turn_player_id = ?, turn_number = 1 WHERE id = ?', [firstPlayer.id, gameId]);
            
            console.log(`✅ Game ${gameId} started with player order:`, shuffledPlayers.map(p => p.player_name));
            
            return { success: true, firstPlayerId: firstPlayer.id };
            
        } catch (error) {
            console.error('Error starting game:', error);
            return { success: false, message: 'Fehler beim Spielstart' };
        }
    }

    // Hilfsfunktionen	
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
	
    getCurrentPlayerIndex(players, currentPlayerId) {
        return players.findIndex(p => p.id === currentPlayerId);
    }

    buildMapMatrix(mapData, mapSize) {
        const matrix = Array(mapSize).fill(null).map(() => Array(mapSize).fill(null));
        
        mapData.forEach(tile => {
            matrix[tile.x_coordinate][tile.y_coordinate] = tile;
        });
        
        return matrix;
    }
	
    getLevelMultiplier(level) {
        switch(level) {
            case 2: return 1.2; // 20% bonus
            case 3: return 1.3; // 30% bonus
            default: return 1.0; // Level 1, kein Bonus
        }
    }
	
    async calculatePathCost(gameId, path, unitName) {
        let totalCost = 0;
        
        // Prüfe ob Einheit fliegen kann (einfache Implementierung)
        const canFly = unitName.toLowerCase().includes('drache') || 
                       unitName.toLowerCase().includes('engel') || 
                       unitName.toLowerCase().includes('adler');
        
        for (let i = 1; i < path.length; i++) { // Start bei 1, da erstes Feld aktuell Position ist
            const tile = path[i];
            const terrain = await db.query(
                'SELECT tt.movement_cost, tt.name FROM game_maps gm JOIN terrain_types tt ON gm.terrain_type_id = tt.id WHERE gm.game_id = ? AND gm.x_coordinate = ? AND gm.y_coordinate = ?',
                [gameId, tile.x, tile.y]
            );
            
            if (terrain.length === 0) continue;
            
            let cost = terrain[0].movement_cost;
            
            // Fliegende Einheiten: Berg und Wasser kosten nur 1
            if (canFly && (terrain[0].name === 'Berg' || terrain[0].name === 'Wasser')) {
                cost = 1;
            }
            
            totalCost += cost;
        }
        
        return totalCost;
    }
}

    // Laden des kompletten Spielzustands
    async loadGameState(gameId) {
        try {
            console.log(`📋 Loading game state for game ${gameId}`);
            
            // Spiel-Grundinformationen
            const game = await db.query('SELECT * FROM games WHERE id = ?', [gameId]);
            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden' };
            }

            // Spieler
            const players = await db.query(`
                SELECT 
                    gp.*,
                    r.name as race_name,
                    r.color_hex as race_color,
                    r.stufe_2_cost,
                    r.stufe_3_cost
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
                    gp.race_level,
                    r.color_hex as player_color
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                JOIN game_players gp ON gu.player_id = gp.id
                JOIN races r ON gp.race_id = r.id
                WHERE gu.game_id = ?
            `, [gameId]);

            const gameState = {
                game: game[0],
                players: players,
                map: this.buildMapMatrix(mapData, game[0].map_size),
                units: units,
                currentPlayerIndex: this.getCurrentPlayerIndex(players, game[0].current_turn_player_id)
            };

            // Cache für bessere Performance
            this.activeGames.set(gameId, gameState);

            return { success: true, gameState: gameState };
            
        } catch (error) {
            console.error('Error loading game state:', error);
            return { success: false, message: 'Fehler beim Laden des Spielzustands' };
        }
    }

    // Spielerzug starten
    async startPlayerTurn(gameId, playerId) {
        try {
            console.log(`🎯 Starting turn for player ${playerId} in game ${gameId}`);
            
            // Gold für Städte/Burgen hinzufügen
            const buildings = await db.query(`
                SELECT bt.gold_income
                FROM game_maps gm
                JOIN building_types bt ON gm.building_type_id = bt.id
                WHERE gm.game_id = ? AND gm.owner_player_id = ?
            `, [gameId, playerId]);

            const goldIncome = buildings.reduce((total, building) => total + building.gold_income, 0);
            
            if (goldIncome > 0) {
                await db.query('UPDATE game_players SET gold = gold + ? WHERE id = ?', [goldIncome, playerId]);
                console.log(`💰 Player ${playerId} received ${goldIncome} gold`);
            }

            // Bewegungspunkte und Angriffsmöglichkeiten für alle Einheiten zurücksetzen
            await db.query(`
                UPDATE game_units gu
                JOIN units u ON gu.unit_id = u.id
                SET gu.movement_points_left = u.movement_points, gu.has_attacked = FALSE
                WHERE gu.game_id = ? AND gu.player_id = ?
            `, [gameId, playerId]);

            return { success: true, goldIncome: goldIncome };
            
        } catch (error) {
            console.error('Error starting player turn:', error);
            return { success: false, message: 'Fehler beim Zugstart' };
        }
    }

    // Einheit kaufen
    async buyUnit(gameId, playerId, cityX, cityY, unitId) {
        try {
            console.log(`💰 Player ${playerId} buying unit ${unitId} at (${cityX}, ${cityY})`);
            
            // Prüfe ob Spieler am Zug ist
            const game = await db.query('SELECT current_turn_player_id FROM games WHERE id = ?', [gameId]);
            if (game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Prüfe Stadt/Burg ownership und dass kein Einheit darauf steht
            const city = await db.query(`
                SELECT gm.building_type_id
                FROM game_maps gm
                WHERE gm.game_id = ? AND gm.x_coordinate = ? AND gm.y_coordinate = ? 
                AND gm.owner_player_id = ? AND gm.building_type_id IS NOT NULL
            `, [gameId, cityX, cityY, playerId]);

            if (city.length === 0) {
                return { success: false, message: 'Keine Stadt/Burg in deinem Besitz an dieser Position' };
            }

            // Prüfe ob Feld frei ist
            const existingUnit = await db.query(
                'SELECT id FROM game_units WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?',
                [gameId, cityX, cityY]
            );

            if (existingUnit.length > 0) {
                return { success: false, message: 'Auf diesem Feld steht bereits eine Einheit' };
            }

            // Lade Einheit-Informationen und Spieler-Level
            const unit = await db.query('SELECT * FROM units WHERE id = ?', [unitId]);
            const player = await db.query('SELECT gold, race_id, race_level FROM game_players WHERE id = ?', [playerId]);
            
            if (unit.length === 0 || player.length === 0) {
                return { success: false, message: 'Einheit oder Spieler nicht gefunden' };
            }

            const unitData = unit[0];
            const playerData = player[0];
            
            // Prüfe ob Einheit zur Rasse gehört
            if (unitData.race_id !== playerData.race_id) {
                return { success: false, message: 'Diese Einheit gehört nicht zu deiner Rasse' };
            }

            // Kosten berechnen
            const unitCost = unitData.cost;
            if (playerData.gold < unitCost) {
                return { success: false, message: `Nicht genug Gold. Benötigt: ${unitCost}, vorhanden: ${playerData.gold}` };
            }

            // Level-Boni berechnen
            const levelMultiplier = this.getLevelMultiplier(playerData.race_level);
            const finalHealth = Math.floor(unitData.health * levelMultiplier);
            const finalAttack = Math.floor(unitData.attack_power * levelMultiplier);
            const finalRange = unitData.attack_range + (playerData.race_level > 1 ? 1 : 0); // +1 Range pro Level

            // Gold abziehen
            await db.query('UPDATE game_players SET gold = gold - ? WHERE id = ?', [unitCost, playerId]);

            // Einheit erstellen
            await db.query(`
                INSERT INTO game_units (game_id, player_id, unit_id, x_coordinate, y_coordinate, current_health, movement_points_left)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [gameId, playerId, unitId, cityX, cityY, finalHealth, unitData.movement_points]);

            console.log(`✅ Unit ${unitData.name} purchased by player ${playerId}`);
            
            return { 
                success: true, 
                unitCost: unitCost, 
                newGold: playerData.gold - unitCost,
                unitData: {
                    ...unitData,
                    current_health: finalHealth,
                    effective_attack: finalAttack,
                    effective_range: finalRange
                }
            };
            
        } catch (error) {
            console.error('Error buying unit:', error);
            return { success: false, message: 'Fehler beim Einheitenkauf' };
        }
    }

    // Zug beenden und nächsten Spieler aktivieren
    async endTurn(gameId, playerId) {
        try {
            console.log(`🔄 Player ${playerId} ending turn in game ${gameId}`);
            
            // Prüfe ob Spieler am Zug ist
            const game = await db.query('SELECT current_turn_player_id, turn_number FROM games WHERE id = ?', [gameId]);
            if (game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Nächsten Spieler finden
            const players = await db.query(
                'SELECT * FROM game_players WHERE game_id = ? AND is_active = 1 ORDER BY turn_order',
                [gameId]
            );

            const currentIndex = players.findIndex(p => p.id === playerId);
            const nextIndex = (currentIndex + 1) % players.length;
            const nextPlayer = players[nextIndex];
            
            // Rundenzähler erhöhen wenn wieder beim ersten Spieler
            const newTurnNumber = nextIndex === 0 ? game[0].turn_number + 1 : game[0].turn_number;

            // Nächsten Spieler setzen
            await db.query(
                'UPDATE games SET current_turn_player_id = ?, turn_number = ? WHERE id = ?',
                [nextPlayer.id, newTurnNumber, gameId]
            );

            // Nächsten Zug starten
            await this.startPlayerTurn(gameId, nextPlayer.id);

            // Prüfe Spielende
            const gameEndResult = await this.checkGameEnd(gameId);

            console.log(`✅ Turn passed from player ${playerId} to ${nextPlayer.id}`);
            
            return { 
                success: true, 
                nextPlayer: nextPlayer,
                newTurnNumber: newTurnNumber,
                gameEnd: gameEndResult
            };
            
        } catch (error) {
            console.error('Error ending turn:', error);
            return { success: false, message: 'Fehler beim Zug beenden' };
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
    async moveUnit(gameId, playerId, fromX, fromY, toX, toY, path) {
        try {
            console.log(`🚶 Player ${playerId} moving unit from (${fromX}, ${fromY}) to (${toX}, ${toY})`);
            
            // Prüfe ob Spieler am Zug ist
            const game = await db.query('SELECT current_turn_player_id FROM games WHERE id = ?', [gameId]);
            if (game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Lade Einheit
            const unit = await db.query(`
                SELECT gu.*, u.movement_points, u.name as unit_name
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                WHERE gu.game_id = ? AND gu.player_id = ? AND gu.x_coordinate = ? AND gu.y_coordinate = ?
            `, [gameId, playerId, fromX, fromY]);

            if (unit.length === 0) {
                return { success: false, message: 'Keine Einheit gefunden' };
            }

            const unitData = unit[0];

            // Prüfe Bewegungspunkte
            if (unitData.movement_points_left <= 0) {
                return { success: false, message: 'Einheit hat keine Bewegungspunkte mehr' };
            }

            // Berechne Pfadkosten
            const pathCost = await this.calculatePathCost(gameId, path, unitData.unit_name);
            
            if (pathCost > unitData.movement_points_left) {
                return { success: false, message: 'Nicht genug Bewegungspunkte für diesen Weg' };
            }

            // Prüfe ob Zielfeld frei ist
            const targetUnit = await db.query(
                'SELECT id FROM game_units WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?',
                [gameId, toX, toY]
            );

            if (targetUnit.length > 0) {
                return { success: false, message: 'Zielfeld ist bereits besetzt' };
            }

            // Bewege Einheit
            await db.query(`
                UPDATE game_units 
                SET x_coordinate = ?, y_coordinate = ?, movement_points_left = movement_points_left - ?
                WHERE id = ?
            `, [toX, toY, pathCost, unitData.id]);

            console.log(`✅ Unit moved from (${fromX}, ${fromY}) to (${toX}, ${toY}), cost: ${pathCost}`);
            
            return { success: true, newMovementPoints: unitData.movement_points_left - pathCost };
            
        } catch (error) {
            console.error('Error moving unit:', error);
            return { success: false, message: 'Fehler bei der Bewegung' };
        }
    }

    // Einheit angreifen
    async attackUnit(gameId, playerId, attackerX, attackerY, defenderX, defenderY) {
        try {
            console.log(`⚔️ Player ${playerId} attacking from (${attackerX}, ${attackerY}) to (${defenderX}, ${defenderY})`);
            
            // Prüfe ob Spieler am Zug ist
            const game = await db.query('SELECT current_turn_player_id FROM games WHERE id = ?', [gameId]);
            if (game[0].current_turn_player_id !== playerId) {
                return { success: false, message: 'Du bist nicht am Zug' };
            }

            // Lade angreifende Einheit
            const attacker = await db.query(`
                SELECT gu.*, u.attack_power, u.attack_range, u.name as unit_name, gp.race_level
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                JOIN game_players gp ON gu.player_id = gp.id
                WHERE gu.game_id = ? AND gu.player_id = ? AND gu.x_coordinate = ? AND gu.y_coordinate = ?
            `, [gameId, playerId, attackerX, attackerY]);

            if (attacker.length === 0) {
                return { success: false, message: 'Angreifende Einheit nicht gefunden' };
            }

            const attackerData = attacker[0];

            // Prüfe ob bereits angegriffen
            if (attackerData.has_attacked) {
                return { success: false, message: 'Diese Einheit hat bereits angegriffen' };
            }

            // Lade verteidigende Einheit
            const defender = await db.query(`
                SELECT gu.*, u.name as unit_name, gp.player_name as defender_player
                FROM game_units gu
                JOIN units u ON gu.unit_id = u.id
                JOIN game_players gp ON gu.player_id = gp.id
                WHERE gu.game_id = ? AND gu.x_coordinate = ? AND gu.y_coordinate = ?
            `, [gameId, defenderX, defenderY]);

            if (defender.length === 0) {
                return { success: false, message: 'Keine Einheit zum Angreifen gefunden' };
            }

            const defenderData = defender[0];

            // Prüfe Reichweite
            const distance = Math.abs(attackerX - defenderX) + Math.abs(attackerY - defenderY);
            let effectiveRange = attackerData.attack_range;
            
            // Fernkampf-Bonus auf Bergen
            const attackerTerrain = await db.query(
                'SELECT tt.name FROM game_maps gm JOIN terrain_types tt ON gm.terrain_type_id = tt.id WHERE gm.game_id = ? AND gm.x_coordinate = ? AND gm.y_coordinate = ?',
                [gameId, attackerX, attackerY]
            );
            
            if (attackerTerrain.length > 0 && attackerTerrain[0].name === 'Berg' && effectiveRange > 1) {
                effectiveRange += 1; // +1 Reichweite auf Berg für Fernkämpfer
            }

            if (distance > effectiveRange) {
                return { success: false, message: 'Ziel außerhalb der Reichweite' };
            }

            // Schaden berechnen
            const levelMultiplier = this.getLevelMultiplier(attackerData.race_level);
            const damage = Math.floor(attackerData.attack_power * levelMultiplier);
            const newHealth = defenderData.current_health - damage;

            // Angriff als verwendet markieren
            await db.query('UPDATE game_units SET has_attacked = TRUE WHERE id = ?', [attackerData.id]);

            // Kampflog eintragen
            await db.query(`
                INSERT INTO battle_log (game_id, attacker_unit_id, defender_unit_id, attacker_damage, turn_number)
                VALUES (?, ?, ?, ?, (SELECT turn_number FROM games WHERE id = ?))
            `, [gameId, attackerData.id, defenderData.id, damage, gameId]);

            if (newHealth <= 0) {
                // Einheit zerstören
                await db.query('DELETE FROM game_units WHERE id = ?', [defenderData.id]);
                console.log(`💀 Unit ${defenderData.unit_name} destroyed`);
                
                return { 
                    success: true, 
                    damage: damage, 
                    unitDestroyed: true,
                    defenderName: defenderData.unit_name 
                };
            } else {
                // Schaden anwenden
                await db.query('UPDATE game_units SET current_health = ? WHERE id = ?', [newHealth, defenderData.id]);
                console.log(`💥 Unit ${defenderData.unit_name} took ${damage} damage, ${newHealth} health remaining`);
                
                return { 
                    success: true, 
                    damage: damage, 
                    unitDestroyed: false,
                    newHealth: newHealth,
                    defenderName: defenderData.unit_name
                };
            }
            
        } catch (error) {
            console.error('Error in attack:', error);
            return { success: false, message: 'Fehler beim Angriff' };
        }
    }

    // Schadenberechnung mit Zufallselement
    calculateDamage(baseDamage) {
        // 80-120% des Grundschadens
        const variance = 0.2;
        const multiplier = 1 + (Math.random() * 2 - 1) * variance;
        return Math.round(baseDamage * multiplier);
    }
	
    // Rassen-Level aufsteigen
    async upgradeRaceLevel(gameId, playerId) {
        try {
            console.log(`📈 Player ${playerId} upgrading race level in game ${gameId}`);
            
            const player = await db.query(`
                SELECT gp.*, r.stufe_2_cost, r.stufe_3_cost
                FROM game_players gp
                JOIN races r ON gp.race_id = r.id
                WHERE gp.id = ?
            `, [playerId]);

            if (player.length === 0) {
                return { success: false, message: 'Spieler nicht gefunden' };
            }

            const playerData = player[0];
            const currentLevel = playerData.race_level || 1;

            if (currentLevel >= 3) {
                return { success: false, message: 'Maximales Level bereits erreicht' };
            }

            const upgradeCost = currentLevel === 1 ? playerData.stufe_2_cost : playerData.stufe_3_cost;
            
            if (playerData.gold < upgradeCost) {
                return { success: false, message: `Nicht genug Gold. Benötigt: ${upgradeCost}` };
            }

            const newLevel = currentLevel + 1;

            // Gold abziehen und Level erhöhen
            await db.query(
                'UPDATE game_players SET gold = gold - ?, race_level = ? WHERE id = ?',
                [upgradeCost, newLevel, playerId]
            );

            console.log(`✅ Player ${playerId} upgraded to level ${newLevel}`);
            
            return { 
                success: true, 
                newLevel: newLevel, 
                cost: upgradeCost,
                newGold: playerData.gold - upgradeCost 
            };
            
        } catch (error) {
            console.error('Error upgrading race level:', error);
            return { success: false, message: 'Fehler beim Level-Aufstieg' };
        }
    }

    // Spielende prüfen
    async checkGameEnd(gameId) {
        try {
            // Spieler mit Einheiten oder Gebäuden
            const activePlayers = await db.query(`
                SELECT DISTINCT gp.id, gp.player_name
                FROM game_players gp
                WHERE gp.game_id = ? AND gp.is_active = 1
                AND (
                    EXISTS(SELECT 1 FROM game_units gu WHERE gu.player_id = gp.id)
                    OR 
                    EXISTS(SELECT 1 FROM game_maps gm WHERE gm.owner_player_id = gp.id AND gm.building_type_id IS NOT NULL)
                )
            `, [gameId]);

            // Spieler ohne Einheiten und Gebäude deaktivieren
            await db.query(`
                UPDATE game_players SET is_active = 0
                WHERE game_id = ? AND is_active = 1
                AND id NOT IN (${activePlayers.map(() => '?').join(',') || 'NULL'})
            `, [gameId, ...activePlayers.map(p => p.id)]);

            if (activePlayers.length <= 1) {
                // Spiel beenden
                await db.query('UPDATE games SET status = "finished", finished_at = NOW() WHERE id = ?', [gameId]);
                
                const winner = activePlayers.length === 1 ? activePlayers[0] : null;
                console.log(`🏆 Game ${gameId} ended. Winner:`, winner ? winner.player_name : 'None');
                
                return { gameEnded: true, winner: winner };
            }

            return { gameEnded: false };
            
        } catch (error) {
            console.error('Error checking game end:', error);
            return { gameEnded: false };
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