// public/js/gameRenderer.js
// Enhanced Game Renderer mit Unit-Darstellung und Interaktion

class GameRenderer {
    constructor(gameManager) {
        this.gameManager = gameManager;
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        
        if (!this.canvas || !this.ctx) {
            console.error('Game canvas not found!');
            return;
        }
        
        // Rendering Properties
        this.tileSize = 40;
        this.zoom = 1.0;
        this.minZoom = 0.3;
        this.maxZoom = 3.0;
        this.offsetX = 0;
        this.offsetY = 0;
        
        // Game State
        this.gameState = null;
        this.selectedUnit = null;
        this.hoveredTile = null;
        this.purchaseMode = false;
        this.actionMode = 'none';
        this.interactionEnabled = true;
        
        // Visual States
        this.possibleMoves = [];
        this.possibleAttacks = [];
        this.movementPath = [];
        
        // Mouse/Touch State
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        // Animation
        this.animationFrame = null;
        
        this.init();
    }

    init() {
        console.log('🎨 Initializing Game Renderer...');
        
        this.setupCanvas();
        this.setupEventListeners();
        this.startRenderLoop();
    }

    setupCanvas() {
        // Responsive Canvas Setup
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        if (!container) return;
        
        const rect = container.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        // Update canvas style for crisp rendering
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        this.render();
    }

    setupEventListeners() {
        // Mouse Events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Touch Events (for mobile)
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    }

    startRenderLoop() {
        const render = () => {
            this.render();
            this.animationFrame = requestAnimationFrame(render);
        };
        render();
    }

    // Main Render Method
    render() {
        if (!this.ctx) return;
        
        // Clear Canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Save context for transformations
        this.ctx.save();
        
        // Apply zoom and pan
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(this.offsetX, this.offsetY);
        
        if (this.gameState) {
            // Render layers in order
            this.renderTerrain();
            this.renderBuildings();
            this.renderMovementOverlay();
            this.renderUnits();
            this.renderUI();
            this.renderHoverEffects();
        } else {
            this.renderLoadingState();
        }
        
        // Restore context
        this.ctx.restore();
    }

    renderTerrain() {
        if (!this.gameState?.map) return;
        
        const mapSize = this.gameState.game.map_size;
        
        // Create terrain grid
        for (let x = 0; x < mapSize; x++) {
            for (let y = 0; y < mapSize; y++) {
                const tile = this.getTileAt(x, y);
                if (!tile) continue;
                
                const screenX = x * this.tileSize;
                const screenY = y * this.tileSize;
                
                // Base terrain
                this.ctx.fillStyle = tile.terrain_color || '#90EE90';
                this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                
                // Terrain border
                this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
                this.ctx.lineWidth = 1;
                this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
                
                // Terrain name (small text)
                if (this.zoom > 0.8) {
                    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    this.ctx.font = '10px Arial';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText(
                        tile.terrain_name?.substring(0, 3) || '',
                        screenX + this.tileSize/2,
                        screenY + this.tileSize - 5
                    );
                }
            }
        }
    }

    renderBuildings() {
        if (!this.gameState?.map) return;
        
        this.gameState.map.forEach(tile => {
            if (tile.building_type_id) {
                this.renderBuilding(tile);
            }
        });
    }

    renderBuilding(tile) {
        const screenX = tile.x_coordinate * this.tileSize;
        const screenY = tile.y_coordinate * this.tileSize;
        const centerX = screenX + this.tileSize/2;
        const centerY = screenY + this.tileSize/2;
        
        // Building background
        this.ctx.fillStyle = tile.building_color || '#FFD700';
        this.ctx.fillRect(screenX + 2, screenY + 2, this.tileSize - 4, this.tileSize - 4);
        
        // Owner color border
        if (tile.owner_player_id) {
            const owner = this.gameState.players?.find(p => p.id === tile.owner_player_id);
            if (owner) {
                this.ctx.strokeStyle = owner.race_color || '#000';
                this.ctx.lineWidth = 3;
                this.ctx.strokeRect(screenX + 2, screenY + 2, this.tileSize - 4, this.tileSize - 4);
            }
        }
        
        // Building icon/symbol
        this.ctx.fillStyle = '#000';
        this.ctx.font = 'bold 16px Arial';
        this.ctx.textAlign = 'center';
        
        const symbol = tile.building_name === 'Stadt' ? '🏘️' : '🏰';
        this.ctx.fillText(symbol, centerX, centerY + 5);
        
        // Building name (if zoomed in)
        if (this.zoom > 1.2) {
            this.ctx.font = '10px Arial';
            this.ctx.fillStyle = '#333';
            this.ctx.fillText(tile.building_name, centerX, screenY + this.tileSize - 15);
        }
    }

    renderUnits() {
        if (!this.gameState?.units) return;
        
        this.gameState.units.forEach(unit => {
            this.renderUnit(unit);
        });
    }

    renderUnit(unit) {
        const screenX = unit.x_coordinate * this.tileSize;
        const screenY = unit.y_coordinate * this.tileSize;
        const centerX = screenX + this.tileSize/2;
        const centerY = screenY + this.tileSize/2;
        
        // Unit background circle
        const isSelected = this.selectedUnit && this.selectedUnit.id === unit.id;
        const isOwnUnit = unit.player_id === this.gameManager.currentPlayer?.id;
        
        // Unit circle
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, this.tileSize/3, 0, 2 * Math.PI);
        
        // Unit color (player color)
        this.ctx.fillStyle = unit.player_color || '#666';
        this.ctx.fill();
        
        // Selection highlight
        if (isSelected) {
            this.ctx.strokeStyle = '#FFD700';
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        } else if (isOwnUnit) {
            this.ctx.strokeStyle = '#FFF';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        } else {
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }
        
        // Unit icon/symbol (simplified)
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        
        // Use first letter of unit name as icon
        const unitIcon = unit.unit_name?.charAt(0).toUpperCase() || 'U';
        this.ctx.fillText(unitIcon, centerX, centerY + 4);
        
        // Health bar
        this.renderHealthBar(unit, screenX, screenY);
        
        // Unit name and stats (if zoomed in)
        if (this.zoom > 1.0) {
            this.ctx.font = '9px Arial';
            this.ctx.fillStyle = '#000';
            this.ctx.fillText(unit.unit_name, centerX, screenY - 5);
        }
        
        // Movement indicator
        if (isOwnUnit && unit.movement_points_left > 0 && !unit.has_attacked) {
            this.ctx.beginPath();
            this.ctx.arc(screenX + this.tileSize - 8, screenY + 8, 4, 0, 2 * Math.PI);
            this.ctx.fillStyle = '#4CAF50';
            this.ctx.fill();
        }
        
        // Attack indicator
        if (isOwnUnit && !unit.has_attacked) {
            this.ctx.beginPath();
            this.ctx.arc(screenX + 8, screenY + 8, 3, 0, 2 * Math.PI);
            this.ctx.fillStyle = '#F44336';
            this.ctx.fill();
        }
    }

    renderHealthBar(unit, screenX, screenY) {
        const barWidth = this.tileSize - 4;
        const barHeight = 4;
        const barX = screenX + 2;
        const barY = screenY + this.tileSize - 6;
        
        const healthPercentage = unit.current_health / unit.max_health;
        
        // Background
        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(barX, barY, barWidth, barHeight);
        
        // Health bar
        let healthColor = '#4CAF50'; // Green
        if (healthPercentage < 0.5) healthColor = '#FF9800'; // Orange
        if (healthPercentage < 0.25) healthColor = '#F44336'; // Red
        
        this.ctx.fillStyle = healthColor;
        this.ctx.fillRect(barX, barY, barWidth * healthPercentage, barHeight);
        
        // Health text
        if (this.zoom > 1.5) {
            this.ctx.fillStyle = '#000';
            this.ctx.font = '8px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(
                `${unit.current_health}/${unit.max_health}`,
                screenX + this.tileSize/2,
                barY - 2
            );
        }
    }

    renderMovementOverlay() {
        // Render possible moves
        this.possibleMoves.forEach(move => {
            const screenX = move.x * this.tileSize;
            const screenY = move.y * this.tileSize;
            
            this.ctx.fillStyle = 'rgba(76, 175, 80, 0.3)';
            this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
            
            this.ctx.strokeStyle = '#4CAF50';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
        });
        
        // Render possible attacks
        this.possibleAttacks.forEach(attack => {
            const screenX = attack.x * this.tileSize;
            const screenY = attack.y * this.tileSize;
            
            this.ctx.fillStyle = 'rgba(244, 67, 54, 0.3)';
            this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
            
            this.ctx.strokeStyle = '#F44336';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
        });
        
        // Render movement path
        if (this.movementPath.length > 1) {
            this.renderMovementPath();
        }
    }

    renderMovementPath() {
        this.ctx.strokeStyle = '#2196F3';
        this.ctx.lineWidth = 4;
        this.ctx.setLineDash([5, 5]);
        
        this.ctx.beginPath();
        
        for (let i = 0; i < this.movementPath.length - 1; i++) {
            const from = this.movementPath[i];
            const to = this.movementPath[i + 1];
            
            const fromX = from.x * this.tileSize + this.tileSize/2;
            const fromY = from.y * this.tileSize + this.tileSize/2;
            const toX = to.x * this.tileSize + this.tileSize/2;
            const toY = to.y * this.tileSize + this.tileSize/2;
            
            if (i === 0) {
                this.ctx.moveTo(fromX, fromY);
            }
            this.ctx.lineTo(toX, toY);
            
            // Arrow head at destination
            if (i === this.movementPath.length - 2) {
                this.drawArrowHead(fromX, fromY, toX, toY);
            }
        }
        
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    drawArrowHead(fromX, fromY, toX, toY) {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const arrowLength = 10;
        
        this.ctx.beginPath();
        this.ctx.moveTo(toX, toY);
        this.ctx.lineTo(
            toX - arrowLength * Math.cos(angle - Math.PI/6),
            toY - arrowLength * Math.sin(angle - Math.PI/6)
        );
        this.ctx.moveTo(toX, toY);
        this.ctx.lineTo(
            toX - arrowLength * Math.cos(angle + Math.PI/6),
            toY - arrowLength * Math.sin(angle + Math.PI/6)
        );
        this.ctx.stroke();
    }

    renderUI() {
        // Render attack ranges for selected unit
        if (this.selectedUnit && this.actionMode === 'attack') {
            this.renderAttackRange(this.selectedUnit);
        }
        
        // Render purchase mode highlights
        if (this.purchaseMode) {
            this.renderPurchaseHighlights();
        }
    }

    renderAttackRange(unit) {
        const range = unit.attack_range;
        const centerX = unit.x_coordinate;
        const centerY = unit.y_coordinate;
        
        // Check for mountain bonus
        const tile = this.getTileAt(centerX, centerY);
        const effectiveRange = (tile?.terrain_name === 'Berg' && range > 1) ? range + 1 : range;
        
        for (let dx = -effectiveRange; dx <= effectiveRange; dx++) {
            for (let dy = -effectiveRange; dy <= effectiveRange; dy++) {
                const distance = Math.abs(dx) + Math.abs(dy);
                if (distance === 0 || distance > effectiveRange) continue;
                
                const targetX = centerX + dx;
                const targetY = centerY + dy;
                
                if (!this.isValidCoordinate(targetX, targetY)) continue;
                
                const screenX = targetX * this.tileSize;
                const screenY = targetY * this.tileSize;
                
                this.ctx.fillStyle = 'rgba(255, 152, 0, 0.2)';
                this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                
                this.ctx.strokeStyle = '#FF9800';
                this.ctx.lineWidth = 1;
                this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
            }
        }
    }

    renderPurchaseHighlights() {
        if (!this.gameState?.map) return;
        
        this.gameState.map.forEach(tile => {
            if (tile.building_type_id && tile.owner_player_id === this.gameManager.currentPlayer?.id) {
                // Check if tile is free
                const hasUnit = this.gameState.units?.some(unit => 
                    unit.x_coordinate === tile.x_coordinate && unit.y_coordinate === tile.y_coordinate
                );
                
                if (!hasUnit) {
                    const screenX = tile.x_coordinate * this.tileSize;
                    const screenY = tile.y_coordinate * this.tileSize;
                    
                    this.ctx.strokeStyle = '#4CAF50';
                    this.ctx.lineWidth = 3;
                    this.ctx.setLineDash([10, 5]);
                    this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
                    this.ctx.setLineDash([]);
                    
                    // Purchase icon
                    this.ctx.fillStyle = 'rgba(76, 175, 80, 0.8)';
                    this.ctx.font = 'bold 16px Arial';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText('💰', 
                        screenX + this.tileSize/2, 
                        screenY + this.tileSize/2 + 5
                    );
                }
            }
        });
    }

    renderHoverEffects() {
        if (!this.hoveredTile) return;
        
        const screenX = this.hoveredTile.x * this.tileSize;
        const screenY = this.hoveredTile.y * this.tileSize;
        
        this.ctx.strokeStyle = '#FFF';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
        
        // Tooltip
        this.renderTooltip(this.hoveredTile);
    }

    renderTooltip(hoveredTile) {
        const tile = this.getTileAt(hoveredTile.x, hoveredTile.y);
        const unit = this.getUnitAt(hoveredTile.x, hoveredTile.y);
        
        if (!tile && !unit) return;
        
        // Tooltip content
        let tooltipLines = [];
        
        if (tile) {
            tooltipLines.push(`${tile.terrain_name} (${tile.movement_cost} MP)`);
            if (tile.building_name) {
                tooltipLines.push(`${tile.building_name} (+${tile.gold_income} Gold)`);
                if (tile.owner_name) {
                    tooltipLines.push(`Besitzer: ${tile.owner_name}`);
                }
            }
        }
        
        if (unit) {
            tooltipLines.push(`${unit.unit_name} (${unit.player_name})`);
            tooltipLines.push(`❤️ ${unit.current_health}/${unit.max_health}`);
            tooltipLines.push(`⚔️ ${unit.attack_power} | 🏃 ${unit.movement_points_left}/${unit.max_movement_points}`);
            tooltipLines.push(`🎯 ${unit.attack_range}`);
        }
        
        if (tooltipLines.length === 0) return;
        
        // Render tooltip
        const padding = 8;
        const lineHeight = 14;
        const tooltipWidth = Math.max(...tooltipLines.map(line => 
            this.ctx.measureText(line).width
        )) + padding * 2;
        const tooltipHeight = tooltipLines.length * lineHeight + padding * 2;
        
        // Position tooltip
        let tooltipX = hoveredTile.x * this.tileSize + this.tileSize + 10;
        let tooltipY = hoveredTile.y * this.tileSize;
        
        // Keep tooltip in bounds
        if (tooltipX + tooltipWidth > this.canvas.width / this.zoom) {
            tooltipX = hoveredTile.x * this.tileSize - tooltipWidth - 10;
        }
        if (tooltipY + tooltipHeight > this.canvas.height / this.zoom) {
            tooltipY = hoveredTile.y * this.tileSize - tooltipHeight;
        }
        
        // Tooltip background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
        
        this.ctx.strokeStyle = '#FFF';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
        
        // Tooltip text
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'left';
        
        tooltipLines.forEach((line, index) => {
            this.ctx.fillText(
                line,
                tooltipX + padding,
                tooltipY + padding + (index + 1) * lineHeight
            );
        });
    }

    renderLoadingState() {
        this.ctx.fillStyle = '#333';
        this.ctx.font = '24px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(
            'Lade Spielzustand...',
            this.canvas.width / 2,
            this.canvas.height / 2
        );
    }

    // Event Handlers
    handleMouseDown(event) {
        if (!this.interactionEnabled) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        this.lastMouseX = mouseX;
        this.lastMouseY = mouseY;
        
        if (event.button === 0) { // Left click
            const tileCoords = this.screenToTile(mouseX, mouseY);
            this.handleTileClick(tileCoords.x, tileCoords.y, event);
        } else if (event.button === 2) { // Right click
            const tileCoords = this.screenToTile(mouseX, mouseY);
            this.handleRightClick(tileCoords.x, tileCoords.y, event);
        }
        
        this.isDragging = true;
    }

    handleMouseMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        // Update hovered tile
        const tileCoords = this.screenToTile(mouseX, mouseY);
        if (this.isValidCoordinate(tileCoords.x, tileCoords.y)) {
            this.hoveredTile = tileCoords;
        } else {
            this.hoveredTile = null;
        }
        
        // Pan handling
        if (this.isDragging && event.buttons === 4) { // Middle mouse drag
            const deltaX = (mouseX - this.lastMouseX) / this.zoom;
            const deltaY = (mouseY - this.lastMouseY) / this.zoom;
            
            this.offsetX += deltaX;
            this.offsetY += deltaY;
        }
        
        this.lastMouseX = mouseX;
        this.lastMouseY = mouseY;
    }

    handleMouseUp(event) {
        this.isDragging = false;
    }

    handleWheel(event) {
        event.preventDefault();
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));
        
        if (newZoom !== this.zoom) {
            // Zoom towards mouse position
            const worldX = (mouseX / this.zoom) - this.offsetX;
            const worldY = (mouseY / this.zoom) - this.offsetY;
            
            this.zoom = newZoom;
            
            const newWorldX = mouseX / this.zoom - this.offsetX;
            const newWorldY = mouseY / this.zoom - this.offsetY;
            
            this.offsetX += newWorldX - worldX;
            this.offsetY += newWorldY - worldY;
        }
    }

    handleTileClick(tileX, tileY, event) {
        if (!this.isValidCoordinate(tileX, tileY)) return;
        
        const tile = this.getTileAt(tileX, tileY);
        const unit = this.getUnitAt(tileX, tileY);
        
        // Pass to game manager
        this.gameManager.onTileClick(tileX, tileY, tile, unit);
    }

    handleRightClick(tileX, tileY, event) {
        // Clear selection or show context menu
        this.gameManager.clearSelection();
    }

    // Touch Events (simplified)
    handleTouchStart(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            this.handleMouseDown({ 
                clientX: touch.clientX, 
                clientY: touch.clientY, 
                button: 0 
            });
        }
    }

    handleTouchMove(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            this.handleMouseMove({ 
                clientX: touch.clientX, 
                clientY: touch.clientY,
                buttons: 0
            });
        }
    }

    handleTouchEnd(event) {
        event.preventDefault();
        this.handleMouseUp({});
    }

    // Coordinate Conversion
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

    // Utility Methods
    isValidCoordinate(x, y) {
        const mapSize = this.gameState?.game?.map_size || 0;
        return x >= 0 && y >= 0 && x < mapSize && y < mapSize;
    }

    getTileAt(x, y) {
        return this.gameState?.map?.find(tile => 
            tile.x_coordinate === x && tile.y_coordinate === y
        );
    }

    getUnitAt(x, y) {
        return this.gameState?.units?.find(unit => 
            unit.x_coordinate === x && unit.y_coordinate === y
        );
    }

    // State Management
    updateGameState(gameState) {
        this.gameState = gameState;
    }

    setSelectedUnit(unit) {
        this.selectedUnit = unit;
        this.calculatePossibleActions();
    }

    clearSelection() {
        this.selectedUnit = null;
        this.possibleMoves = [];
        this.possibleAttacks = [];
        this.movementPath = [];
        this.actionMode = 'none';
    }

    setPurchaseMode(enabled) {
        this.purchaseMode = enabled;
    }

    setActionMode(mode) {
        this.actionMode = mode;
        this.calculatePossibleActions();
    }

    enableInteraction() {
        this.interactionEnabled = true;
    }

    disableInteraction() {
        this.interactionEnabled = false;
        this.clearSelection();
    }

    calculatePossibleActions() {
        if (!this.selectedUnit || !this.interactionEnabled) {
            this.possibleMoves = [];
            this.possibleAttacks = [];
            return;
        }
        
        if (this.actionMode === 'move') {
            this.calculatePossibleMoves();
        } else if (this.actionMode === 'attack') {
            this.calculatePossibleAttacks();
        } else {
            // Default: show both
            this.calculatePossibleMoves();
            this.calculatePossibleAttacks();
        }
    }

    calculatePossibleMoves() {
        if (!this.selectedUnit) return;
        
        this.possibleMoves = [];
        const maxRange = this.selectedUnit.movement_points_left;
        const startX = this.selectedUnit.x_coordinate;
        const startY = this.selectedUnit.y_coordinate;
        
        // Simple implementation - can be enhanced with proper pathfinding
        for (let dx = -maxRange; dx <= maxRange; dx++) {
            for (let dy = -maxRange; dy <= maxRange; dy++) {
                const distance = Math.abs(dx) + Math.abs(dy);
                if (distance === 0 || distance > maxRange) continue;
                
                const targetX = startX + dx;
                const targetY = startY + dy;
                
                if (this.isValidCoordinate(targetX, targetY)) {
                    // Check if tile is free
                    const hasUnit = this.getUnitAt(targetX, targetY);
                    if (!hasUnit) {
                        this.possibleMoves.push({ x: targetX, y: targetY });
                    }
                }
            }
        }
    }

    calculatePossibleAttacks() {
        if (!this.selectedUnit) return;
        
        this.possibleAttacks = [];
        const range = this.selectedUnit.attack_range;
        const startX = this.selectedUnit.x_coordinate;
        const startY = this.selectedUnit.y_coordinate;
        
        // Check for mountain bonus
        const tile = this.getTileAt(startX, startY);
        const effectiveRange = (tile?.terrain_name === 'Berg' && range > 1) ? range + 1 : range;
        
        for (let dx = -effectiveRange; dx <= effectiveRange; dx++) {
            for (let dy = -effectiveRange; dy <= effectiveRange; dy++) {
                const distance = Math.abs(dx) + Math.abs(dy);
                if (distance === 0 || distance > effectiveRange) continue;
                
                const targetX = startX + dx;
                const targetY = startY + dy;
                
                if (this.isValidCoordinate(targetX, targetY)) {
                    // Check for enemy unit
                    const targetUnit = this.getUnitAt(targetX, targetY);
                    if (targetUnit && targetUnit.player_id !== this.selectedUnit.player_id) {
                        this.possibleAttacks.push({ x: targetX, y: targetY });
                    }
                }
            }
        }
    }

    // Movement Path Calculation (for preview)
    calculateMovementPath(fromX, fromY, toX, toY) {
        // Simple path - can be enhanced
        const path = [];
        let currentX = fromX;
        let currentY = fromY;
        
        path.push({ x: currentX, y: currentY });
        
        // Move horizontally first, then vertically
        while (currentX !== toX) {
            currentX += currentX < toX ? 1 : -1;
            path.push({ x: currentX, y: currentY });
        }
        
        while (currentY !== toY) {
            currentY += currentY < toY ? 1 : -1;
            path.push({ x: currentX, y: currentY });
        }
        
        this.movementPath = path;
    }

    // Cleanup
    destroy() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }
}