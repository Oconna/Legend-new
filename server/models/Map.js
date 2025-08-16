const db = require('../config/database');

class MapGenerator {
    constructor() {
        this.terrainTypes = [];
        this.buildingTypes = [];
    }

    async loadTerrainTypes() {
        if (this.terrainTypes.length === 0) {
            this.terrainTypes = await db.query('SELECT * FROM terrain_types ORDER BY id');
        }
        return this.terrainTypes;
    }

    async loadBuildingTypes() {
        if (this.buildingTypes.length === 0) {
            this.buildingTypes = await db.query('SELECT * FROM building_types ORDER BY id');
        }
        return this.buildingTypes;
    }

    async generateMap(gameId, mapSize, players) {
        try {
            console.log(`Generiere Karte für Spiel ${gameId}: ${mapSize}x${mapSize} mit ${players.length} Spielern`);

            // Lade Terrain- und Gebäudetypen
            await this.loadTerrainTypes();
            await this.loadBuildingTypes();

            // Erstelle leere Karte
            const map = this.createEmptyMap(mapSize);

            // Generiere Basisgelände
            this.generateTerrain(map, mapSize);

            // Platziere Startpositionen für Spieler (Städte)
            const playerStartPositions = this.generatePlayerStartPositions(map, mapSize, players.length);

            // Platziere zusätzliche Städte und Burgen
            this.placeAdditionalBuildings(map, mapSize, players.length);

            // Optimiere Karte (stelle sicher, dass alle Positionen erreichbar sind)
            this.optimizeMap(map, mapSize);

            // Speichere Karte in Datenbank
            await this.saveMapToDatabase(gameId, map, mapSize, players, playerStartPositions);

            console.log(`✓ Karte erfolgreich generiert und gespeichert`);
            return { success: true };

        } catch (error) {
            console.error('Fehler bei der Kartengenerierung:', error);
            throw error;
        }
    }

    createEmptyMap(mapSize) {
        const map = [];
        for (let x = 0; x < mapSize; x++) {
            map[x] = [];
            for (let y = 0; y < mapSize; y++) {
                map[x][y] = {
                    x: x,
                    y: y,
                    terrainTypeId: 1, // Default: Gras
                    buildingTypeId: null,
                    ownerId: null
                };
            }
        }
        return map;
    }

    generateTerrain(map, mapSize) {
        // Verwende Perlin Noise ähnliche Technik für natürlichere Karten
        // Für jetzt: vereinfachte Zufallsverteilung mit Clustern

        // Terrain Wahrscheinlichkeiten (IDs basierend auf DB)
        const terrainDistribution = [
            { id: 1, name: 'Gras', weight: 40 },      // 40% Gras
            { id: 2, name: 'Berg', weight: 15 },      // 15% Berge  
            { id: 3, name: 'Sumpf', weight: 10 },     // 10% Sumpf
            { id: 4, name: 'Wasser', weight: 12 },    // 12% Wasser
            { id: 5, name: 'Wald', weight: 18 },      // 18% Wald
            { id: 6, name: 'Wüste', weight: 3 },      // 3% Wüste
            { id: 7, name: 'Schnee', weight: 2 }      // 2% Schnee
        ];

        // Erstelle Seed-Punkte für verschiedene Biome
        const seedPoints = this.createTerrainSeeds(mapSize, terrainDistribution);

        // Fülle Karte basierend auf Distanz zu Seed-Punkten
        for (let x = 0; x < mapSize; x++) {
            for (let y = 0; y < mapSize; y++) {
                map[x][y].terrainTypeId = this.determineTerrainAtPosition(x, y, seedPoints, terrainDistribution);
            }
        }

        // Glätte Übergänge und reduziere einzelne Pixel
        this.smoothTerrain(map, mapSize);
    }

    createTerrainSeeds(mapSize, terrainDistribution) {
        const seeds = [];
        const numSeeds = Math.floor(mapSize * 0.3); // 30% der Kartengröße als Seed-Anzahl

        for (let i = 0; i < numSeeds; i++) {
            const terrainType = this.weightedRandomTerrain(terrainDistribution);
            seeds.push({
                x: Math.floor(Math.random() * mapSize),
                y: Math.floor(Math.random() * mapSize),
                terrainTypeId: terrainType.id,
                influence: Math.random() * 8 + 4 // Radius 4-12
            });
        }

        return seeds;
    }

    weightedRandomTerrain(terrainDistribution) {
        const totalWeight = terrainDistribution.reduce((sum, terrain) => sum + terrain.weight, 0);
        let random = Math.random() * totalWeight;

        for (const terrain of terrainDistribution) {
            random -= terrain.weight;
            if (random <= 0) {
                return terrain;
            }
        }

        return terrainDistribution[0]; // Fallback
    }

    determineTerrainAtPosition(x, y, seedPoints, terrainDistribution) {
        // Finde nächsten Seed-Punkt
        let closestSeed = null;
        let minDistance = Infinity;

        for (const seed of seedPoints) {
            const distance = Math.sqrt(Math.pow(x - seed.x, 2) + Math.pow(y - seed.y, 2));
            const influenceDistance = distance / seed.influence;

            if (influenceDistance < 1 && distance < minDistance) {
                minDistance = distance;
                closestSeed = seed;
            }
        }

        if (closestSeed) {
            return closestSeed.terrainTypeId;
        }

        // Wenn kein Seed in Reichweite, verwende Standard-Terrain (Gras)
        return 1;
    }

    smoothTerrain(map, mapSize) {
        // Zweifacher Smoothing-Pass um isolierte Pixel zu reduzieren
        for (let pass = 0; pass < 2; pass++) {
            const newMap = JSON.parse(JSON.stringify(map)); // Deep copy

            for (let x = 1; x < mapSize - 1; x++) {
                for (let y = 1; y < mapSize - 1; y++) {
                    const neighbors = this.getNeighborTerrain(map, x, y);
                    const currentTerrain = map[x][y].terrainTypeId;

                    // Wenn aktuelle Zelle von anderen Terrain-Typen umgeben ist
                    const differentNeighbors = neighbors.filter(n => n !== currentTerrain).length;
                    if (differentNeighbors >= 6) {
                        // Verwende häufigsten Nachbar-Terrain-Typ
                        const terrainCounts = {};
                        neighbors.forEach(terrain => {
                            terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;
                        });

                        const mostCommon = Object.keys(terrainCounts).reduce((a, b) => 
                            terrainCounts[a] > terrainCounts[b] ? a : b
                        );

                        newMap[x][y].terrainTypeId = parseInt(mostCommon);
                    }
                }
            }

            // Übernehme geglättete Karte
            for (let x = 0; x < mapSize; x++) {
                for (let y = 0; y < mapSize; y++) {
                    map[x][y].terrainTypeId = newMap[x][y].terrainTypeId;
                }
            }
        }
    }

    getNeighborTerrain(map, x, y) {
        const neighbors = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < map.length && ny >= 0 && ny < map[0].length) {
                    neighbors.push(map[nx][ny].terrainTypeId);
                }
            }
        }
        return neighbors;
    }

    generatePlayerStartPositions(map, mapSize, playerCount) {
        const startPositions = [];
        const minDistance = Math.floor(mapSize / 4); // Mindestabstand zwischen Spielern

        for (let i = 0; i < playerCount; i++) {
            let attempts = 0;
            let position = null;

            while (attempts < 100) { // Maximal 100 Versuche
                const x = Math.floor(Math.random() * mapSize);
                const y = Math.floor(Math.random() * mapSize);

                // Prüfe Abstand zu anderen Spielern
                let validPosition = true;
                for (const existingPos of startPositions) {
                    const distance = Math.sqrt(Math.pow(x - existingPos.x, 2) + Math.pow(y - existingPos.y, 2));
                    if (distance < minDistance) {
                        validPosition = false;
                        break;
                    }
                }

                // Prüfe ob Position auf grasland oder wald ist (gute Startpositionen)
                if (validPosition && (map[x][y].terrainTypeId === 1 || map[x][y].terrainTypeId === 5)) {
                    position = { x, y };
                    break;
                }

                attempts++;
            }

            // Fallback: Finde irgendeine freie Position
            if (!position) {
                for (let x = 0; x < mapSize; x++) {
                    for (let y = 0; y < mapSize; y++) {
                        if (map[x][y].terrainTypeId !== 4) { // Nicht Wasser
                            let validPosition = true;
                            for (const existingPos of startPositions) {
                                const distance = Math.sqrt(Math.pow(x - existingPos.x, 2) + Math.pow(y - existingPos.y, 2));
                                if (distance < minDistance / 2) { // Reduzierter Mindestabstand
                                    validPosition = false;
                                    break;
                                }
                            }
                            if (validPosition) {
                                position = { x, y };
                                break;
                            }
                        }
                    }
                    if (position) break;
                }
            }

            if (position) {
                // Platziere Stadt für Spieler
                map[position.x][position.y].buildingTypeId = 1; // Stadt
                map[position.x][position.y].terrainTypeId = 1; // Stelle sicher, dass es Grasland ist
                startPositions.push(position);
            }
        }

        return startPositions;
    }

    placeAdditionalBuildings(map, mapSize, playerCount) {
        // Berechne Anzahl zusätzlicher Gebäude basierend auf Kartengröße
        const totalBuildings = Math.floor((mapSize * mapSize) / 200); // 1 Gebäude pro 200 Felder
        const additionalBuildings = Math.max(0, totalBuildings - playerCount);

        let placedBuildings = 0;
        let attempts = 0;

        while (placedBuildings < additionalBuildings && attempts < 1000) {
            const x = Math.floor(Math.random() * mapSize);
            const y = Math.floor(Math.random() * mapSize);

            // Prüfe ob Position geeignet ist
            if (map[x][y].buildingTypeId === null && 
                map[x][y].terrainTypeId !== 4 && // Nicht Wasser
                map[x][y].terrainTypeId !== 2) { // Nicht Berg

                // 70% Chance für Stadt, 30% für Burg
                const buildingTypeId = Math.random() < 0.7 ? 1 : 2;
                map[x][y].buildingTypeId = buildingTypeId;
                
                placedBuildings++;
            }

            attempts++;
        }

        console.log(`Zusätzliche Gebäude platziert: ${placedBuildings} von ${additionalBuildings} geplanten`);
    }

    optimizeMap(map, mapSize) {
        // Stelle sicher, dass Wasser nicht komplett Landmassen isoliert
        // Vereinfachte Implementierung: Entferne Wasser das zu isolierte Inseln führt

        for (let x = 1; x < mapSize - 1; x++) {
            for (let y = 1; y < mapSize - 1; y++) {
                if (map[x][y].terrainTypeId === 4) { // Wasser
                    const landNeighbors = this.getNeighborTerrain(map, x, y).filter(t => t !== 4).length;
                    
                    // Wenn Wasser von viel Land umgeben ist, wandle es in Sumpf um
                    if (landNeighbors >= 6) {
                        map[x][y].terrainTypeId = 3; // Sumpf
                    }
                }
            }
        }
    }

    async saveMapToDatabase(gameId, map, mapSize, players, startPositions) {
        try {
            // Lösche eventuell existierende Kartendaten
            await db.query('DELETE FROM game_maps WHERE game_id = ?', [gameId]);

            // Speichere alle Kartenfelder
            const batchSize = 500; // Batch-Einfügungen für bessere Performance
            
            for (let batch = 0; batch < Math.ceil((mapSize * mapSize) / batchSize); batch++) {
                const values = [];
                const placeholders = [];

                const startIdx = batch * batchSize;
                const endIdx = Math.min(startIdx + batchSize, mapSize * mapSize);

                for (let i = startIdx; i < endIdx; i++) {
                    const x = Math.floor(i / mapSize);
                    const y = i % mapSize;
                    const cell = map[x][y];

                    values.push(gameId, x, y, cell.terrainTypeId, cell.buildingTypeId || null, cell.ownerId || null);
                    placeholders.push('(?, ?, ?, ?, ?, ?)');
                }

                if (values.length > 0) {
                    const query = `
                        INSERT INTO game_maps (game_id, x_coordinate, y_coordinate, terrain_type_id, building_type_id, owner_player_id) 
                        VALUES ${placeholders.join(', ')}
                    `;
                    
                    await db.query(query, values);
                }
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

            console.log(`✓ Karte gespeichert: ${mapSize}x${mapSize} = ${mapSize * mapSize} Felder`);

        } catch (error) {
            console.error('Fehler beim Speichern der Karte:', error);
            throw error;
        }
    }

    // Hilfsfunktion: Finde freie Position um ein Gebäude herum
    findFreePositionAround(map, centerX, centerY, maxRadius = 2) {
        for (let radius = 1; radius <= maxRadius; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                        const x = centerX + dx;
                        const y = centerY + dy;
                        
                        if (x >= 0 && x < map.length && y >= 0 && y < map[0].length) {
                            if (map[x][y].buildingTypeId === null && map[x][y].terrainTypeId !== 4) {
                                return { x, y };
                            }
                        }
                    }
                }
            }
        }
        return null;
    }
}

module.exports = MapGenerator;