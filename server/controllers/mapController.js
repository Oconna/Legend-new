// server/controllers/mapController.js
// Karten-Controller für die Kartengenerierung

const db = require('../config/database');

class MapController {
    constructor() {
        this.terrainDistribution = {
            gras: { min: 40, max: 50, terrainId: 1 },      // 40-50%
            berg: { min: 10, max: 15, terrainId: 2 },       // 10-15%
            sumpf: { min: 8, max: 12, terrainId: 3 },       // 8-12%
            wasser: { min: 15, max: 20, terrainId: 4 },     // 15-20%
            wald: { min: 15, max: 20, terrainId: 5 },       // 15-20%
            wueste: { min: 5, max: 8, terrainId: 6 },       // 5-8%
            schnee: { min: 2, max: 5, terrainId: 7 }        // 2-5%
        };
        
        this.cityBuildingId = 1;  // Stadt
        this.castleBuildingId = 2; // Burg
    }

    // Prüfe ob alle Spieler eine Rasse bestätigt haben
    async checkAllPlayersRaceConfirmed(gameId) {
        try {
            const result = await db.query(`
                SELECT 
                    COUNT(*) as total_players,
                    SUM(CASE WHEN race_id IS NOT NULL AND race_confirmed = 1 THEN 1 ELSE 0 END) as confirmed_players
                FROM game_players 
                WHERE game_id = ? AND is_active = 1
            `, [gameId]);

            const { total_players, confirmed_players } = result[0];
            
            console.log(`Game ${gameId}: ${confirmed_players}/${total_players} players confirmed races`);
            
            return {
                allConfirmed: total_players > 0 && confirmed_players === total_players,
                totalPlayers: total_players,
                confirmedPlayers: confirmed_players
            };

        } catch (error) {
            console.error('Error checking race confirmations:', error);
            return { allConfirmed: false, totalPlayers: 0, confirmedPlayers: 0 };
        }
    }

    // Hauptfunktion: Karte generieren
    async generateMap(gameId) {
        try {
            console.log(`🗺️ Starting map generation for game ${gameId}`);

            // Hole Spielinformationen
            const game = await db.query(`
                SELECT g.*, COUNT(gp.id) as player_count
                FROM games g
                LEFT JOIN game_players gp ON g.id = gp.game_id AND gp.is_active = 1
                WHERE g.id = ? AND g.status = 'race_selection'
                GROUP BY g.id
            `, [gameId]);

            if (game.length === 0) {
                return { success: false, message: 'Spiel nicht gefunden oder nicht in Rassenauswahl-Phase' };
            }

            const gameData = game[0];
            const mapSize = gameData.map_size;
            const playerCount = gameData.player_count;

            console.log(`Map size: ${mapSize}x${mapSize}, Players: ${playerCount}`);

            // Hole Spieler-IDs
            const players = await db.query(`
                SELECT id, player_name, race_id
                FROM game_players 
                WHERE game_id = ? AND is_active = 1 AND race_id IS NOT NULL
                ORDER BY turn_order
            `, [gameId]);

            if (players.length !== playerCount) {
                return { success: false, message: 'Nicht alle Spieler haben eine Rasse ausgewählt' };
            }

            // 1. Lösche alte Kartendaten falls vorhanden
            await db.query('DELETE FROM game_maps WHERE game_id = ?', [gameId]);

            // 2. Erstelle leere Karte
            const map = this.createEmptyMap(mapSize);

            // 3. Generiere Basisgelände
            this.generateBaseTerrain(map, mapSize);

            // 4. Platziere Startpositionen (eine Stadt pro Spieler)
            const startPositions = this.generatePlayerStartPositions(map, mapSize, playerCount);

            // 5. Platziere zusätzliche Städte und Burgen
            this.placeAdditionalBuildings(map, mapSize, playerCount, startPositions);

            // 6. Optimiere Karte für natürlichere Landschaft
            this.optimizeTerrainClusters(map, mapSize);

            // 7. Speichere Karte in Datenbank
            await this.saveMapToDatabase(gameId, map, mapSize, players, startPositions);

            // 8. Ändere Spielstatus zu "playing"
            await db.query(`
                UPDATE games 
                SET status = 'playing', started_at = NOW(), current_turn_player_id = ?
                WHERE id = ?
            `, [players[0].id, gameId]);

            console.log(`✅ Map generation completed for game ${gameId}`);

            return {
                success: true,
                mapSize: mapSize,
                playerCount: playerCount,
                message: 'Karte erfolgreich generiert'
            };

        } catch (error) {
            console.error('Error generating map:', error);
            return { success: false, message: 'Fehler bei der Kartengenerierung: ' + error.message };
        }
    }

    // Erstelle leere Karte
    createEmptyMap(size) {
        const map = [];
        for (let x = 0; x < size; x++) {
            map[x] = [];
            for (let y = 0; y < size; y++) {
                map[x][y] = {
                    terrainTypeId: 1, // Standard: Gras
                    buildingTypeId: null,
                    ownerId: null
                };
            }
        }
        return map;
    }

    // Generiere Basisgelände mit konfigurierbaren Prozentsätzen
    generateBaseTerrain(map, size) {
        console.log('Generating base terrain...');

        const totalTiles = size * size;
        const terrainCounts = {};

        // Berechne Anzahl Tiles pro Terrain-Typ
        for (const [terrainName, config] of Object.entries(this.terrainDistribution)) {
            const percentage = this.randomBetween(config.min, config.max);
            terrainCounts[config.terrainId] = Math.floor(totalTiles * percentage / 100);
        }

        // Erstelle Array mit allen Terrain-IDs
        const terrainArray = [];
        for (const [terrainId, count] of Object.entries(terrainCounts)) {
            for (let i = 0; i < count; i++) {
                terrainArray.push(parseInt(terrainId));
            }
        }

        // Fülle restliche Tiles mit Gras auf
        while (terrainArray.length < totalTiles) {
            terrainArray.push(1); // Gras
        }

        // Mische Array zufällig
        this.shuffleArray(terrainArray);

        // Weise Terrain-Typen zu
        let index = 0;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                map[x][y].terrainTypeId = terrainArray[index++];
            }
        }

        console.log('Base terrain generated with distribution:', terrainCounts);
    }

    // Generiere gleichmäßig verteilte Startpositionen
    generatePlayerStartPositions(map, size, playerCount) {
        console.log(`Generating ${playerCount} start positions...`);

        const startPositions = [];
        const minDistance = Math.floor(size / 4); // Mindestabstand zwischen Startpositionen

        for (let i = 0; i < playerCount; i++) {
            let position;
            let attempts = 0;
            const maxAttempts = 1000;

            do {
                // Verteile Spieler grob in einem Kreis um die Kartenmitte
                const angle = (2 * Math.PI * i) / playerCount;
                const radius = size * 0.3; // 30% vom Kartenrand zur Mitte
                const centerX = Math.floor(size / 2);
                const centerY = Math.floor(size / 2);

                const baseX = Math.floor(centerX + radius * Math.cos(angle));
                const baseY = Math.floor(centerY + radius * Math.sin(angle));

                // Kleine zufällige Variation hinzufügen
                const offsetX = this.randomBetween(-3, 3);
                const offsetY = this.randomBetween(-3, 3);

                position = {
                    x: Math.max(2, Math.min(size - 3, baseX + offsetX)),
                    y: Math.max(2, Math.min(size - 3, baseY + offsetY))
                };

                attempts++;
            } while (
                attempts < maxAttempts &&
                (this.isPositionTooClose(position, startPositions, minDistance) ||
                 map[position.x][position.y].terrainTypeId === 4) // Nicht auf Wasser
            );

            if (attempts >= maxAttempts) {
                console.warn(`Could not find ideal position for player ${i + 1}, using fallback`);
                // Fallback: Finde irgendeine freie Position
                position = this.findFallbackPosition(map, size, startPositions);
            }

            // Platziere Stadt an Startposition
            map[position.x][position.y].terrainTypeId = 1; // Gras unter Stadt
            map[position.x][position.y].buildingTypeId = this.cityBuildingId;
            
            startPositions.push(position);
            console.log(`Player ${i + 1} start position: (${position.x}, ${position.y})`);
        }

        return startPositions;
    }

    // Platziere zusätzliche Städte und Burgen
    placeAdditionalBuildings(map, size, playerCount, startPositions) {
        console.log('Placing additional buildings...');

        const citiesPerPlayer = 5; // Jeder Spieler bekommt insgesamt 5 Städte (inklusive Startstadt)
        const castlesPerPlayer = 2; // Jeder Spieler bekommt 2 Burgen
        
        const totalAdditionalCities = (citiesPerPlayer - 1) * playerCount; // -1 da Startstadt schon existiert
        const totalCastles = castlesPerPlayer * playerCount;

        // Platziere zusätzliche Städte
        this.placeBuildingsRandomly(map, size, this.cityBuildingId, totalAdditionalCities, startPositions);

        // Platziere Burgen
        this.placeBuildingsRandomly(map, size, this.castleBuildingId, totalCastles, startPositions);

        console.log(`Placed ${totalAdditionalCities} additional cities and ${totalCastles} castles`);
    }

    // Platziere Gebäude zufällig auf der Karte
    placeBuildingsRandomly(map, size, buildingTypeId, count, excludePositions) {
        const placedPositions = [...excludePositions];
        let placed = 0;
        let attempts = 0;
        const maxAttempts = count * 50; // Verhindere Endlosschleife

        while (placed < count && attempts < maxAttempts) {
            const x = this.randomBetween(1, size - 2);
            const y = this.randomBetween(1, size - 2);
            
            const position = { x, y };

            // Prüfe ob Position geeignet ist
            if (map[x][y].buildingTypeId === null && // Kein anderes Gebäude
                map[x][y].terrainTypeId !== 4 && // Nicht auf Wasser
                !this.isPositionTooClose(position, placedPositions, 3)) { // Mindestabstand zu anderen Gebäuden

                map[x][y].terrainTypeId = 1; // Gras unter Gebäude
                map[x][y].buildingTypeId = buildingTypeId;
                placedPositions.push(position);
                placed++;
            }

            attempts++;
        }

        if (placed < count) {
            console.warn(`Could only place ${placed}/${count} buildings of type ${buildingTypeId}`);
        }
    }

    // Optimiere Terrain für natürlichere Cluster
    optimizeTerrainClusters(map, size) {
        console.log('Optimizing terrain clusters...');

        // Mehrere Durchgänge für natürlichere Cluster
        for (let pass = 0; pass < 3; pass++) {
            for (let x = 1; x < size - 1; x++) {
                for (let y = 1; y < size - 1; y++) {
                    // Überspringe Felder mit Gebäuden
                    if (map[x][y].buildingTypeId !== null) continue;

                    const neighbors = this.getNeighboringTerrain(map, x, y, size);
                    const mostCommonTerrain = this.getMostCommonTerrain(neighbors);

                    // 30% Chance, dass sich Terrain an Nachbarn anpasst
                    if (Math.random() < 0.3 && mostCommonTerrain !== map[x][y].terrainTypeId) {
                        map[x][y].terrainTypeId = mostCommonTerrain;
                    }
                }
            }
        }
    }

    // Speichere Karte in Datenbank
    async saveMapToDatabase(gameId, map, size, players, startPositions) {
        console.log('Saving map to database...');

        try {
            // Batch-Insert für bessere Performance
            const batchSize = 1000;
            const values = [];

            for (let x = 0; x < size; x++) {
                for (let y = 0; y < size; y++) {
                    const cell = map[x][y];
                    values.push([
                        gameId,
                        x,
                        y,
                        cell.terrainTypeId,
                        cell.buildingTypeId,
                        cell.ownerId
                    ]);
                }
            }

            // Führe Batch-Inserts aus
            for (let i = 0; i < values.length; i += batchSize) {
                const batch = values.slice(i, i + batchSize);
                const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
                const flatValues = batch.flat();

                await db.query(`
                    INSERT INTO game_maps (game_id, x_coordinate, y_coordinate, terrain_type_id, building_type_id, owner_player_id)
                    VALUES ${placeholders}
                `, flatValues);
            }

            // Setze Besitzer für Startpositionen
            for (let i = 0; i < startPositions.length; i++) {
                const position = startPositions[i];
                const player = players[i];

                await db.query(`
                    UPDATE game_maps 
                    SET owner_player_id = ? 
                    WHERE game_id = ? AND x_coordinate = ? AND y_coordinate = ?
                `, [player.id, gameId, position.x, position.y]);
            }

            console.log(`✅ Map saved: ${size}x${size} = ${size * size} tiles`);

        } catch (error) {
            console.error('Error saving map to database:', error);
            throw error;
        }
    }

    // Hilfsfunktionen
    randomBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    isPositionTooClose(position, existingPositions, minDistance) {
        return existingPositions.some(existing => {
            const distance = Math.abs(position.x - existing.x) + Math.abs(position.y - existing.y);
            return distance < minDistance;
        });
    }

    findFallbackPosition(map, size, excludePositions) {
        for (let x = 2; x < size - 2; x++) {
            for (let y = 2; y < size - 2; y++) {
                const position = { x, y };
                if (!this.isPositionTooClose(position, excludePositions, 5) &&
                    map[x][y].terrainTypeId !== 4) {
                    return position;
                }
            }
        }
        // Absolute Fallback
        return { x: Math.floor(size / 2), y: Math.floor(size / 2) };
    }

    getNeighboringTerrain(map, x, y, size) {
        const neighbors = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                    neighbors.push(map[nx][ny].terrainTypeId);
                }
            }
        }
        return neighbors;
    }

    getMostCommonTerrain(terrainArray) {
        const counts = {};
        terrainArray.forEach(terrain => {
            counts[terrain] = (counts[terrain] || 0) + 1;
        });
        
        return parseInt(Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b));
    }

    // Hole vollständige Kartendaten
    async getMapData(gameId) {
        try {
            const mapData = await db.query(`
                SELECT 
                    gm.*,
                    tt.name as terrain_name,
                    tt.color_hex as terrain_color,
                    tt.image_filename as terrain_image,
                    tt.movement_cost,
                    bt.name as building_name,
                    bt.color_hex as building_color,
                    bt.image_filename as building_image,
                    bt.gold_income,
                    gp.player_name as owner_name,
                    r.color_hex as owner_race_color
                FROM game_maps gm
                JOIN terrain_types tt ON gm.terrain_type_id = tt.id
                LEFT JOIN building_types bt ON gm.building_type_id = bt.id
                LEFT JOIN game_players gp ON gm.owner_player_id = gp.id
                LEFT JOIN races r ON gp.race_id = r.id
                WHERE gm.game_id = ?
                ORDER BY gm.x_coordinate, gm.y_coordinate
            `, [gameId]);

            return { success: true, mapData };

        } catch (error) {
            console.error('Error getting map data:', error);
            return { success: false, message: error.message };
        }
    }
}

module.exports = new MapController();