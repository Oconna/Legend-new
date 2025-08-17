// public/js/gameRenderer.js
// Spielfeld-Renderer für das Strategiespiel

class GameRenderer {
    constructor(canvas, gameManager) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.gameManager = gameManager;
        
        // Rendering-Einstellungen
        this.tileSize = 32;
        this.offsetX = 0;
        this.offsetY = 0;
        this.zoom = 1;
        this.minZoom = 0.5;
        this.maxZoom = 3;
        
        // Spielfeld-Daten
        this.mapData = null;
        this.units = null;
        this.gameState = null;
        
        // Interaktion
        this.selectedUnit = null;
        this.hoveredTile = null;
        this.possibleMoves = [];
        this.possibleAttacks = [];
        
        // Rendering-Cache
        this.terrainCache = new Map();
        this.unitCache = new Map();
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // Mouse Events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Keyboard Events
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    // Spielzustand aktualisieren
    updateGameState(gameState) {
        this.gameState = gameState;
        this.mapData = gameState.map;
        this.units = gameState.units;
        this.render();
    }

    // Hauptrender-Methode
    render() {
        if (!this.gameState) return;
        
        // Canvas leeren
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Transformationen anwenden
        this.ctx.save();
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(this.offsetX, this.offsetY);
        
        // Sichtbaren Bereich berechnen
        const viewBounds = this.getViewBounds();
        
        // Rendern in Schichten
        this.renderTerrain(viewBounds);
        this.renderBuildings(viewBounds);
        this.renderPossibleMoves();
        this.renderPossibleAttacks();
        this.renderUnits(viewBounds);
        this.renderSelection();
        this.renderHover();
        this.renderUI();
        
        this.ctx.restore();
    }

    // Terrain rendern
    renderTerrain(viewBounds) {
        if (!this.mapData) return;
        
        for (const tile of this.mapData) {
            // Nur sichtbare Tiles rendern
            if (tile.x_coordinate < viewBounds.minX || tile.x_coordinate > viewBounds.maxX ||
                tile.y_coordinate < viewBounds.minY || tile.y_coordinate > viewBounds.maxY) {
                continue;
            }
            
            const x = tile.x_coordinate * this.tileSize;
            const y = tile.y_coordinate * this.tileSize;
            
            // Terrain-Farbe
            this.ctx.fillStyle = tile.terrain_color || '#90EE90';
            this.ctx.fillRect(x, y, this.tileSize, this.tileSize);
            
            // Terrain-Typ-Text (bei großem Zoom)
            if (this.zoom > 1.5) {
                this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
                this.ctx.font = '8px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(
                    tile.terrain_name?.substring(0, 3) || 'T',
                    x + this.tileSize / 2,
                    y + this.tileSize - 2
                );
            }
            
            // Grid-Linien
            this.ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, y, this.tileSize, this.tileSize);
        }
    }

    // Gebäude rendern
    renderBuildings(viewBounds) {
        if (!this.mapData) return;
        
        for (const tile of this.mapData) {
            if (!tile.building_type_id) continue;
            
            if (tile.x_coordinate < viewBounds.minX || tile.x_coordinate > viewBounds.maxX ||
                tile.y_coordinate < viewBounds.minY || tile.y_coordinate > viewBounds.maxY) {
                continue;
            }
            
            const x = tile.x_coordinate * this.tileSize;
            const y = tile.y_coordinate * this.tileSize;
            
            // Gebäude-Hintergrund
            this.ctx.fillStyle = tile.building_color || '#FFD700';
            this.ctx.fillRect(x + 2, y + 2, this.tileSize - 4, this.tileSize - 4);
            
            // Besitzer-Rand
            if (tile.owner_player_id) {
                const owner = this.gameState.players.find(p => p.id === tile.owner_player_id);
                if (owner) {
                    this.ctx.strokeStyle = owner.race_color || '#000';
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(x + 1, y + 1, this.tileSize - 2, this.tileSize - 2);
                }
            }
            
            // Gebäude-Symbol
            this.ctx.fillStyle = 'black';
            this.ctx.font = 'bold 16px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            const symbol = tile.building_type_id === 1 ? '🏰' : '🏛️';
            this.ctx.fillText(symbol, x + this.tileSize / 2, y + this.tileSize / 2);
        }
    }

    // Einheiten rendern
    renderUnits(viewBounds) {
        if (!this.units) return;
        
        for (const unit of this.units) {
            if (unit.x_coordinate < viewBounds.minX || unit.x_coordinate > viewBounds.maxX ||
                unit.y_coordinate < viewBounds.minY || unit.y_coordinate > viewBounds.maxY) {
                continue;
            }
            
            const x = unit.x_coordinate * this.tileSize;
            const y = unit.y_coordinate * this.tileSize;
            
            // Einheiten-Kreis
            const centerX = x + this.tileSize / 2;
            const centerY = y + this.tileSize / 2;
            const radius = this.tileSize / 3;
            
            // Spielerfarbe
            this.ctx.fillStyle = unit.player_color || '#666';
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            this.ctx.fill();
            
            // Rand
            this.ctx.strokeStyle = 'black';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            
            // Einheiten-Symbol/Name
            this.ctx.fillStyle = 'white';
            this.ctx.font = 'bold 10px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(
                unit.unit_name?.substring(0, 2) || 'U',
                centerX,
                centerY
            );
            
            // Gesundheitsbalken
            if (unit.current_health < unit.max_health) {
                const barWidth = this.tileSize - 4;
                const barHeight = 4;
                const healthPercent = unit.current_health / unit.max_health;
                
                // Hintergrund
                this.ctx.fillStyle = 'red';
                this.ctx.fillRect(x + 2, y - 6, barWidth, barHeight);
                
                // Gesundheit
                this.ctx.fillStyle = 'green';
                this.ctx.fillRect(x + 2, y - 6, barWidth * healthPercent, barHeight);
            }
            
            // Bewegungspunkte-Indikator
            if (unit.movement_points_left < unit.max_movement_points || unit.has_attacked) {
                const indicator = unit.has_attacked ? '⚔️' : '🏃';
                this.ctx.fillStyle = 'white';
                this.ctx.font = '10px Arial';
                this.ctx.fillText(indicator, x + this.tileSize - 8, y + 8);
            }
        }
    }

    // Mögliche Züge anzeigen
    renderPossibleMoves() {
        for (const move of this.possibleMoves) {
            const x = move.x * this.tileSize;
            const y = move.y * this.tileSize;
            
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
            this.ctx.fillRect(x, y, this.tileSize, this.tileSize);
            
            this.ctx.strokeStyle = 'green';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(x, y, this.tileSize, this.tileSize);
        }
    }

    // Mögliche Angriffe anzeigen
    renderPossibleAttacks() {
        for (const attack of this.possibleAttacks) {
            const x = attack.x * this.tileSize;
            const y = attack.y * this.tileSize;
            
            this.ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            this.ctx.fillRect(x, y, this.tileSize, this.tileSize);
            
            this.ctx.strokeStyle = 'red';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(x, y, this.tileSize, this.tileSize);
        }
    }

    // Auswahl rendern
    renderSelection() {
        if (!this.selectedUnit) return;
        
        const x = this.selectedUnit.x_coordinate * this.tileSize;
        const y = this.selectedUnit.y_coordinate * this.tileSize;
        
        this.ctx.strokeStyle = 'yellow';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(x, y, this.tileSize, this.tileSize);
        
        // Pulsierende Animation
        const pulse = Math.sin(Date.now() / 200) * 0.5 + 0.5;
        this.ctx.strokeStyle = `rgba(255, 255, 0, ${pulse})`;
        this.ctx.lineWidth = 5;
        this.ctx.strokeRect(x - 2, y - 2, this.tileSize + 4, this.tileSize + 4);
    }

    // Hover-Effekt rendern
    renderHover() {
        if (!this.hoveredTile) return;
        
        const x = this.hoveredTile.x * this.tileSize;
        const y = this.hoveredTile.y * this.tileSize;
        
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, y, this.tileSize, this.tileSize);
    }

    // UI-Elemente rendern
    renderUI() {
        this.ctx.restore();
        this.ctx.save();
        
        // Koordinaten anzeigen
        if (this.hoveredTile) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            this.ctx.fillRect(10, 10, 200, 30);
            
            this.ctx.fillStyle = 'white';
            this.ctx.font = '14px Arial';
            this.ctx.textAlign = 'left';
            this.ctx.fillText(
                `Position: (${this.hoveredTile.x}, ${this.hoveredTile.y})`,
                15, 30
            );
        }
        
        // Zoom-Level anzeigen
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(this.canvas.width - 120, 10, 110, 30);
        
        this.ctx.fillStyle = 'white';
        this.ctx.font = '14px Arial';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(
            `Zoom: ${Math.round(this.zoom * 100)}%`,
            this.canvas.width - 115, 30
        );
    }

    // Mouse Events
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const tilePos = this.screenToTile(mouseX, mouseY);
        
        if (e.button === 0) { // Linksklick
            this.handleLeftClick(tilePos.x, tilePos.y, e);
        } else if (e.button === 2) { // Rechtsklick
            this.handleRightClick(tilePos.x, tilePos.y, e);
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const tilePos = this.screenToTile(mouseX, mouseY);
        
        // Aktualisiere Hover-Position
        if (this.isValidTile(tilePos.x, tilePos.y)) {
            this.hoveredTile = { x: tilePos.x, y: tilePos.y };
            this.updateHoverInfo(tilePos.x, tilePos.y);
        } else {
            this.hoveredTile = null;
        }
        
        this.render();
    }

    handleMouseUp(e) {
        // Implementierung für Drag-and-Drop falls benötigt
    }

    handleWheel(e) {
        e.preventDefault();
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Zoom zum Mauszeiger
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));
        
        if (newZoom !== this.zoom) {
            // Berechne neuen Offset um zum Mauszeiger zu zoomen
            const worldX = (mouseX / this.zoom) - this.offsetX;
            const worldY = (mouseY / this.zoom) - this.offsetY;
            
            this.zoom = newZoom;
            
            this.offsetX = (mouseX / this.zoom) - worldX;
            this.offsetY = (mouseY / this.zoom) - worldY;
            
            this.render();
        }
    }

    // Tastatur Events
    handleKeyDown(e) {
        const moveSpeed = 50 / this.zoom;
        
        switch (e.key) {
            case 'ArrowLeft':
            case 'a':
                this.offsetX += moveSpeed;
                this.render();
                break;
            case 'ArrowRight':
            case 'd':
                this.offsetX -= moveSpeed;
                this.render();
                break;
            case 'ArrowUp':
            case 'w':
                this.offsetY += moveSpeed;
                this.render();
                break;
            case 'ArrowDown':
            case 's':
                this.offsetY -= moveSpeed;
                this.render();
                break;
            case 'Escape':
                this.clearSelection();
                break;
            case '+':
            case '=':
                this.zoomIn();
                break;
            case '-':
                this.zoomOut();
                break;
        }
    }

    // Spiellogik Events
    handleLeftClick(tileX, tileY, e) {
        if (!this.isValidTile(tileX, tileY)) return;
        
        const unit = this.getUnitAt(tileX, tileY);
        const isOwnUnit = unit && this.isOwnUnit(unit);
        
        if (this.selectedUnit) {
            // Es ist bereits eine Einheit ausgewählt
            if (isOwnUnit && unit.id === this.selectedUnit.id) {
                // Gleiche Einheit angeklickt - Auswahl aufheben
                this.clearSelection();
            } else if (isOwnUnit) {
                // Andere eigene Einheit angeklickt - neue Auswahl
                this.selectUnit(unit);
            } else if (this.canMoveToTile(tileX, tileY)) {
                // Bewegung ausführen
                this.gameManager.moveUnit(this.selectedUnit.id, tileX, tileY);
            } else if (this.canAttackTile(tileX, tileY)) {
                // Angriff ausführen
                this.gameManager.attackUnit(this.selectedUnit.id, tileX, tileY);
            } else {
                // Ungültiger Zug - Auswahl beibehalten
                this.gameManager.showNotification('Ungültiger Zug', 'warning');
            }
        } else {
            // Keine Einheit ausgewählt
            if (isOwnUnit) {
                this.selectUnit(unit);
            }
        }
    }

    handleRightClick(tileX, tileY, e) {
        // Rechtsklick hebt Auswahl auf oder zeigt Kontextmenü
        this.clearSelection();
    }

    // Einheiten-Auswahl
    selectUnit(unit) {
        this.selectedUnit = unit;
        this.calculatePossibleActions();
        this.gameManager.updateSelectedUnitInfo(unit);
        this.render();
    }

    clearSelection() {
        this.selectedUnit = null;
        this.possibleMoves = [];
        this.possibleAttacks = [];
        this.gameManager.clearSelectedUnitInfo();
        this.render();
    }

    // Mögliche Aktionen berechnen
    calculatePossibleActions() {
        if (!this.selectedUnit) return;
        
        this.possibleMoves = this.calculatePossibleMoves(this.selectedUnit);
        this.possibleAttacks = this.calculatePossibleAttacks(this.selectedUnit);
    }

    calculatePossibleMoves(unit) {
        const moves = [];
        const maxDistance = Math.floor(unit.movement_points_left);
        
        for (let dx = -maxDistance; dx <= maxDistance; dx++) {
            for (let dy = -maxDistance; dy <= maxDistance; dy++) {
                const targetX = unit.x_coordinate + dx;
                const targetY = unit.y_coordinate + dy;
                
                if (this.isValidTile(targetX, targetY) && 
                    this.canUnitMoveToTile(unit, targetX, targetY)) {
                    moves.push({ x: targetX, y: targetY });
                }
            }
        }
        
        return moves;
    }

    calculatePossibleAttacks(unit) {
        const attacks = [];
        const range = unit.attack_range;
        
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                const distance = Math.abs(dx) + Math.abs(dy);
                if (distance === 0 || distance > range) continue;
                
                const targetX = unit.x_coordinate + dx;
                const targetY = unit.y_coordinate + dy;
                
                if (this.isValidTile(targetX, targetY)) {
                    const targetUnit = this.getUnitAt(targetX, targetY);
                    if (targetUnit && !this.isOwnUnit(targetUnit)) {
                        attacks.push({ x: targetX, y: targetY });
                    }
                }
            }
        }
        
        return attacks;
    }

    // Hilfsfunktionen
    screenToTile(screenX, screenY) {
        const worldX = (screenX / this.zoom) - this.offsetX;
        const worldY = (screenY / this.zoom) - this.offsetY;
        
        return {
            x: Math.floor(worldX / this.tileSize),
            y: Math.floor(worldY / this.tileSize)
        };
    }

    tileToScreen(tileX, tileY) {
        const worldX = tileX * this.tileSize;
        const worldY = tileY * this.tileSize;
        
        return {
            x: (worldX + this.offsetX) * this.zoom,
            y: (worldY + this.offsetY) * this.zoom
        };
    }

    isValidTile(x, y) {
        return x >= 0 && y >= 0 && 
               x < this.gameState?.game?.map_size && 
               y < this.gameState?.game?.map_size;
    }

    getUnitAt(x, y) {
        return this.units?.find(unit => 
            unit.x_coordinate === x && unit.y_coordinate === y
        );
    }

    isOwnUnit(unit) {
        return unit && this.gameManager.currentPlayer && 
               unit.player_id === this.gameManager.currentPlayer.id;
    }

    canMoveToTile(x, y) {
        return this.possibleMoves.some(move => move.x === x && move.y === y);
    }

    canAttackTile(x, y) {
        return this.possibleAttacks.some(attack => attack.x === x && attack.y === y);
    }

    canUnitMoveToTile(unit, x, y) {
        // Prüfe ob Ziel frei ist
        const targetUnit = this.getUnitAt(x, y);
        if (targetUnit) return false;
        
        // Prüfe Bewegungskosten
        const tile = this.getTileAt(x, y);
        if (!tile) return false;
        
        const distance = Math.abs(x - unit.x_coordinate) + Math.abs(y - unit.y_coordinate);
        const movementCost = distance * tile.movement_cost;
        
        return movementCost <= unit.movement_points_left;
    }

    getTileAt(x, y) {
        return this.mapData?.find(tile => 
            tile.x_coordinate === x && tile.y_coordinate === y
        );
    }

    updateHoverInfo(x, y) {
        const tile = this.getTileAt(x, y);
        const unit = this.getUnitAt(x, y);
        
        let info = `(${x}, ${y})`;
        
        if (tile) {
            info += ` - ${tile.terrain_name}`;
            if (tile.building_name) {
                info += ` - ${tile.building_name}`;
                if (tile.owner_name) {
                    info += ` (${tile.owner_name})`;
                }
            }
        }
        
        if (unit) {
            info += ` - ${unit.unit_name} (${unit.player_name})`;
            info += ` HP: ${unit.current_health}/${unit.max_health}`;
        }
        
        this.gameManager.updateHoverInfo(info);
    }

    // Kamera-Steuerung
    zoomIn() {
        this.zoom = Math.min(this.maxZoom, this.zoom * 1.2);
        this.render();
    }

    zoomOut() {
        this.zoom = Math.max(this.minZoom, this.zoom / 1.2);
        this.render();
    }

    centerOnTile(x, y) {
        this.offsetX = (this.canvas.width / 2 / this.zoom) - (x * this.tileSize) - (this.tileSize / 2);
        this.offsetY = (this.canvas.height / 2 / this.zoom) - (y * this.tileSize) - (this.tileSize / 2);
        this.render();
    }

    getViewBounds() {
        const leftWorld = -this.offsetX;
        const topWorld = -this.offsetY;
        const rightWorld = leftWorld + (this.canvas.width / this.zoom);
        const bottomWorld = topWorld + (this.canvas.height / this.zoom);
        
        return {
            minX: Math.floor(leftWorld / this.tileSize) - 1,
            minY: Math.floor(topWorld / this.tileSize) - 1,
            maxX: Math.ceil(rightWorld / this.tileSize) + 1,
            maxY: Math.ceil(bottomWorld / this.tileSize) + 1
        };
    }

    // Canvas-Größe anpassen
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.render();
    }

    // Minimap rendern
    renderMinimap(minimapCanvas) {
        if (!this.gameState || !minimapCanvas) return;
        
        const minimapCtx = minimapCanvas.getContext('2d');
        const mapSize = this.gameState.game.map_size;
        const scale = minimapCanvas.width / mapSize;
        
        minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
        
        // Terrain
        for (const tile of this.mapData) {
            minimapCtx.fillStyle = tile.terrain_color || '#90EE90';
            minimapCtx.fillRect(
                tile.x_coordinate * scale,
                tile.y_coordinate * scale,
                scale,
                scale
            );
            
            // Gebäude
            if (tile.building_type_id) {
                minimapCtx.fillStyle = tile.building_color || '#FFD700';
                minimapCtx.fillRect(
                    tile.x_coordinate * scale + 1,
                    tile.y_coordinate * scale + 1,
                    scale - 2,
                    scale - 2
                );
            }
        }
        
        // Einheiten
        for (const unit of this.units) {
            minimapCtx.fillStyle = unit.player_color || '#666';
            minimapCtx.fillRect(
                unit.x_coordinate * scale,
                unit.y_coordinate * scale,
                scale,
                scale
            );
        }
        
        // Sichtbereich
        const viewBounds = this.getViewBounds();
        minimapCtx.strokeStyle = 'red';
        minimapCtx.lineWidth = 2;
        minimapCtx.strokeRect(
            Math.max(0, viewBounds.minX * scale),
            Math.max(0, viewBounds.minY * scale),
            Math.min(minimapCanvas.width, (viewBounds.maxX - viewBounds.minX) * scale),
            Math.min(minimapCanvas.height, (viewBounds.maxY - viewBounds.minY) * scale)
        );
    }
}