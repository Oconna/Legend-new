// public/js/gameClient.js
// Client-seitiger Code für das Strategiespiel

class StrategyGameClient {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.playerName = null;
        this.playerId = null;
        this.gameState = null;
        this.selectedTile = null;
        this.selectedUnit = null;
        this.gameAction = null; // 'move', 'attack', 'buy'
        this.movementPath = [];
        this.canvas = null;
        this.ctx = null;
        this.tileSize = 32;
        this.mapOffset = { x: 0, y: 0 };
        this.zoomLevel = 1.0;
        this.isDragging = false;
        this.lastMousePos = { x: 0, y: 0 };
        
        this.init();
    }

    init() {
        console.log('🎮 Initializing Strategy Game Client');
        
        // URL-Parameter parsen
        this.parseUrlParameters();
        
        if (!this.gameId || !this.playerName) {
            this.showError('Ungültige Spielparameter. Zurück zur Lobby...');
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }

        // Socket-Verbindung
        this.initSocket();
        
        // Canvas initialisieren
        this.initCanvas();
        
        // Event Listeners
        this.setupEventListeners();
        
        // UI initialisieren
        this.initUI();
        
        // Spielzustand laden
        this.requestGameState();
    }

    parseUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        this.gameId = urlParams.get('gameId');
        this.playerName = urlParams.get('playerName');
        console.log('URL Parameters:', { gameId: this.gameId, playerName: this.playerName });
    }

    initSocket() {
        console.log('🔌 Connecting to socket...');
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('✅ Socket connected');
            this.joinGameRoom();
        });

        this.socket.on('disconnect', () => {
            console.log('📡 Socket disconnected');
            this.showNotification('Verbindung verloren. Versuche neu zu verbinden...', 'error');
        });

        // Spielzustand Events
        this.socket.on('game_state', (data) => {
            if (data.success) {
                this.gameState = data.gameState;
                this.findPlayerId();
                this.render();
                this.updateUI();
                console.log('📋 Game state updated');
            }
        });

        this.socket.on('turn_started', (data) => {
            console.log('🎯 Turn started:', data);
            this.showNotification(`${data.playerName} ist am Zug`, 'info');
            if (data.playerId === this.playerId) {
                this.showNotification(`Du bist am Zug! +${data.goldIncome} Gold erhalten`, 'success');
            }
            this.requestGameState(); // Aktualisiere Spielzustand
        });

        this.socket.on('unit_bought', (data) => {
            console.log('💰 Unit bought:', data);
            this.showNotification(`${data.unitName} gekauft für ${data.cost} Gold`, 'success');
            this.requestGameState();
        });

        this.socket.on('unit_moved', (data) => {
            console.log('🚶 Unit moved:', data);
            this.showNotification(`${data.unitName} bewegt`, 'info');
            this.requestGameState();
        });

        this.socket.on('unit_attacked', (data) => {
            console.log('⚔️ Unit attacked:', data);
            if (data.unitDestroyed) {
                this.showNotification(`${data.defenderName} zerstört! ${data.damage} Schaden`, 'success');
            } else {
                this.showNotification(`${data.defenderName} angegriffen! ${data.damage} Schaden`, 'info');
            }
            this.requestGameState();
        });

        this.socket.on('race_upgraded', (data) => {
            console.log('📈 Race upgraded:', data);
            this.showNotification(`Rasse auf Level ${data.newLevel} aufgestiegt!`, 'success');
            this.requestGameState();
        });

        this.socket.on('turn_ended', (data) => {
            console.log('🔄 Turn ended:', data);
            this.showNotification(`${data.nextPlayer.player_name} ist jetzt am Zug`, 'info');
            this.requestGameState();
        });

        this.socket.on('game_ended', (data) => {
            console.log('🏆 Game ended:', data);
            if (data.winner) {
                this.showNotification(`Spiel beendet! ${data.winner.player_name} hat gewonnen!`, 'success');
            } else {
                this.showNotification('Spiel beendet! Unentschieden.', 'info');
            }
        });

        this.socket.on('error', (message) => {
            console.error('Socket error:', message);
            this.showNotification(message, 'error');
        });
    }

    initCanvas() {
        this.canvas = document.getElementById('gameCanvas');
        if (!this.canvas) {
            console.error('Canvas element not found');
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        
        // Canvas Größe setzen
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const container = document.getElementById('gameContainer');
        if (container && this.canvas) {
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;
            this.render();
        }
    }

    setupEventListeners() {
        // Canvas Events
        if (this.canvas) {
            this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
            this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
            this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
            this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        }

        // UI Buttons
        document.getElementById('endTurnBtn')?.addEventListener('click', () => this.endTurn());
        document.getElementById('upgradeRaceBtn')?.addEventListener('click', () => this.upgradeRace());
        
        // Aktions-Buttons
        document.getElementById('moveActionBtn')?.addEventListener('click', () => this.setAction('move'));
        document.getElementById('attackActionBtn')?.addEventListener('click', () => this.setAction('attack'));
        document.getElementById('buyActionBtn')?.addEventListener('click', () => this.setAction('buy'));
        document.getElementById('cancelActionBtn')?.addEventListener('click', () => this.cancelAction());

        // Keyboard
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    initUI() {
        // UI Elemente initialisieren
        this.updatePlayerInfo();
    }

    joinGameRoom() {
        console.log(`Joining game room: ${this.gameId}`);
        this.socket.emit('join_db_game_room', {
            gameId: this.gameId,
            playerName: this.playerName
        });
    }

    requestGameState() {
        console.log('📋 Requesting game state...');
        this.socket.emit('get_game_state', { gameId: this.gameId });
    }

    findPlayerId() {
        if (this.gameState && this.gameState.players) {
            const player = this.gameState.players.find(p => p.player_name === this.playerName);
            this.playerId = player ? player.id : null;
            console.log('Player ID found:', this.playerId);
        }
    }

    // Rendering
    render() {
        if (!this.gameState || !this.ctx) return;
        
        // Canvas löschen
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Koordinaten-Transformation
        this.ctx.save();
        this.ctx.scale(this.zoomLevel, this.zoomLevel);
        this.ctx.translate(this.mapOffset.x, this.mapOffset.y);
        
        // Karte rendern
        this.renderMap();
        
        // Einheiten rendern
        this.renderUnits();
        
        // UI Overlays
        this.renderUI();
        
        this.ctx.restore();
    }

    renderMap() {
        const map = this.gameState.map;
        const mapSize = this.gameState.game.map_size;
        
        for (let x = 0; x < mapSize; x++) {
            for (let y = 0; y < mapSize; y++) {
                const tile = map[x][y];
                if (!tile) continue;
                
                const screenX = x * this.tileSize;
                const screenY = y * this.tileSize;
                
                // Terrain rendern
                this.ctx.fillStyle = tile.terrain_color || '#90EE90';
                this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                
                // Grid
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
                
                // Gebäude rendern
                if (tile.building_type_id) {
                    this.ctx.fillStyle = tile.building_color || '#FFD700';
                    this.ctx.fillRect(screenX + 4, screenY + 4, this.tileSize - 8, this.tileSize - 8);
                    
                    // Gebäude Name
                    this.ctx.fillStyle = '#000000';
                    this.ctx.font = '10px Arial';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText(tile.building_name?.charAt(0) || 'B', screenX + this.tileSize/2, screenY + this.tileSize/2 + 3);
                }
                
                // Ausgewähltes Tile highlighten
                if (this.selectedTile && this.selectedTile.x === x && this.selectedTile.y === y) {
                    this.ctx.strokeStyle = '#FFD700';
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
                }
            }
        }
    }

    renderUnits() {
        if (!this.gameState.units) return;
        
        this.gameState.units.forEach(unit => {
            const screenX = unit.x_coordinate * this.tileSize;
            const screenY = unit.y_coordinate * this.tileSize;
            
            // Einheit Kreis
            this.ctx.beginPath();
            this.ctx.arc(screenX + this.tileSize/2, screenY + this.tileSize/2, this.tileSize/3, 0, Math.PI * 2);
            this.ctx.fillStyle = unit.player_color || '#FF0000';
            this.ctx.fill();
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            
            // Lebenspunkte anzeigen
            this.ctx.fillStyle = '#000000';
            this.ctx.font = '10px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`❤️${unit.current_health}`, screenX + this.tileSize/2, screenY + this.tileSize - 3);
            
            // Einheit Name (abgekürzt)
            const unitName = unit.unit_name.length > 8 ? unit.unit_name.substring(0, 6) + '..' : unit.unit_name;
            this.ctx.font = '8px Arial';
            this.ctx.fillText(unitName, screenX + this.tileSize/2, screenY + 12);
            
            // Bewegungsreichweite anzeigen (falls Einheit ausgewählt)
            if (this.selectedUnit && this.selectedUnit.id === unit.id && this.gameAction === 'move') {
                this.renderMovementRange(unit);
            }
            
            // Angriffsreichweite anzeigen
            if (this.selectedUnit && this.selectedUnit.id === unit.id && this.gameAction === 'attack') {
                this.renderAttackRange(unit);
            }
        });
    }

    renderMovementRange(unit) {
        const range = unit.movement_points_left || 0;
        
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                const distance = Math.abs(dx) + Math.abs(dy);
                if (distance > 0 && distance <= range) {
                    const x = unit.x_coordinate + dx;
                    const y = unit.y_coordinate + dy;
                    
                    if (this.isValidCoordinate(x, y)) {
                        const screenX = x * this.tileSize;
                        const screenY = y * this.tileSize;
                        
                        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                    }
                }
            }
        }
    }

    renderAttackRange(unit) {
        let range = unit.effective_range || unit.attack_range || 1;
        
        // Berg-Bonus für Fernkämpfer prüfen
        const tile = this.gameState.map[unit.x_coordinate][unit.y_coordinate];
        if (tile && tile.terrain_name === 'Berg' && range > 1) {
            range += 1;
        }
        
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                const distance = Math.abs(dx) + Math.abs(dy);
                if (distance > 0 && distance <= range) {
                    const x = unit.x_coordinate + dx;
                    const y = unit.y_coordinate + dy;
                    
                    if (this.isValidCoordinate(x, y)) {
                        const screenX = x * this.tileSize;
                        const screenY = y * this.tileSize;
                        
                        // Prüfe ob Feind auf dem Feld steht
                        const enemyUnit = this.gameState.units.find(u => 
                            u.x_coordinate === x && u.y_coordinate === y && u.player_id !== this.playerId
                        );
                        
                        this.ctx.fillStyle = enemyUnit ? 'rgba(255, 0, 0, 0.5)' : 'rgba(255, 165, 0, 0.3)';
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                    }
                }
            }
        }
    }

    renderUI() {
        // Bewegungspfad anzeigen
        if (this.movementPath.length > 1) {
            this.renderMovementPath();
        }
    }

    renderMovementPath() {
        this.ctx.strokeStyle = this.isValidMovementPath() ? '#00FF00' : '#FF0000';
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([5, 5]);
        
        this.ctx.beginPath();
        for (let i = 0; i < this.movementPath.length; i++) {
            const point = this.movementPath[i];
            const screenX = point.x * this.tileSize + this.tileSize / 2;
            const screenY = point.y * this.tileSize + this.tileSize / 2;
            
            if (i === 0) {
                this.ctx.moveTo(screenX, screenY);
            } else {
                this.ctx.lineTo(screenX, screenY);
            }
        }
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    // Maus Events
    handleMouseDown(e) {
        this.isDragging = true;
        this.lastMousePos = this.getMousePos(e);
    }

    handleMouseMove(e) {
        const mousePos = this.getMousePos(e);
        
        if (this.isDragging) {
            const deltaX = mousePos.x - this.lastMousePos.x;
            const deltaY = mousePos.y - this.lastMousePos.y;
            
            this.mapOffset.x += deltaX / this.zoomLevel;
            this.mapOffset.y += deltaY / this.zoomLevel;
            
            this.render();
        }
        
        this.lastMousePos = mousePos;
    }

    handleMouseUp(e) {
        this.isDragging = false;
    }

    handleCanvasClick(e) {
        if (this.isDragging) return;
        
        const mousePos = this.getMousePos(e);
        const worldPos = this.screenToWorld(mousePos);
        const tilePos = this.worldToTile(worldPos);
        
        if (!this.isValidCoordinate(tilePos.x, tilePos.y)) return;
        
        this.handleTileClick(tilePos.x, tilePos.y);
    }

    handleTileClick(x, y) {
        console.log(`Tile clicked: (${x}, ${y})`);
        
        const tile = this.gameState.map[x][y];
        const unit = this.gameState.units.find(u => u.x_coordinate === x && u.y_coordinate === y);
        
        // Aktion ausführen basierend auf aktueller Aktion
        switch (this.gameAction) {
            case 'move':
                this.handleMoveAction(x, y);
                break;
            case 'attack':
                this.handleAttackAction(x, y);
                break;
            case 'buy':
                this.handleBuyAction(x, y, tile);
                break;
            default:
                this.handleDefaultClick(x, y, tile, unit);
                break;
        }
    }

    handleDefaultClick(x, y, tile, unit) {
        // Tile/Einheit auswählen
        this.selectedTile = { x, y };
        this.selectedUnit = unit;
        
        if (unit && unit.player_id === this.playerId) {
            console.log('Own unit selected:', unit.unit_name);
            this.showUnitInfo(unit);
        } else if (tile && tile.building_type_id && tile.owner_player_id === this.playerId) {
            console.log('Own building selected:', tile.building_name);
            this.showBuildingInfo(tile);
        }
        
        this.render();
        this.updateActionButtons();
    }

    handleMoveAction(x, y) {
        if (!this.selectedUnit || this.selectedUnit.player_id !== this.playerId) {
            this.showNotification('Wähle zuerst eine eigene Einheit aus', 'warning');
            return;
        }
        
        // Pfad berechnen
        this.movementPath = this.calculateMovementPath(
            { x: this.selectedUnit.x_coordinate, y: this.selectedUnit.y_coordinate },
            { x, y }
        );
        
        this.render();
        
        // Bewegung ausführen wenn gültiger Pfad
        if (this.isValidMovementPath()) {
            this.executeMove();
        }
    }

    handleAttackAction(x, y) {
        if (!this.selectedUnit || this.selectedUnit.player_id !== this.playerId) {
            this.showNotification('Wähle zuerst eine eigene Einheit aus', 'warning');
            return;
        }
        
        const targetUnit = this.gameState.units.find(u => u.x_coordinate === x && u.y_coordinate === y);
        if (!targetUnit || targetUnit.player_id === this.playerId) {
            this.showNotification('Wähle eine feindliche Einheit zum Angriff', 'warning');
            return;
        }
        
        this.executeAttack(targetUnit);
    }

    handleBuyAction(x, y, tile) {
        if (!tile || !tile.building_type_id || tile.owner_player_id !== this.playerId) {
            this.showNotification('Wähle eine eigene Stadt oder Burg', 'warning');
            return;
        }
        
        // Zeige Einheitenkauf-Dialog
        this.showUnitPurchaseDialog(x, y);
    }

    // Aktionen ausführen
    executeMove() {
        if (!this.selectedUnit || this.movementPath.length < 2) return;
        
        const fromPos = this.movementPath[0];
        const toPos = this.movementPath[this.movementPath.length - 1];
        
        this.socket.emit('move_unit', {
            gameId: this.gameId,
            playerId: this.playerId,
            fromX: fromPos.x,
            fromY: fromPos.y,
            toX: toPos.x,
            toY: toPos.y,
            path: this.movementPath
        });
        
        this.cancelAction();
    }

    executeAttack(targetUnit) {
        if (!this.selectedUnit) return;
        
        this.socket.emit('attack_unit', {
            gameId: this.gameId,
            playerId: this.playerId,
            attackerX: this.selectedUnit.x_coordinate,
            attackerY: this.selectedUnit.y_coordinate,
            defenderX: targetUnit.x_coordinate,
            defenderY: targetUnit.y_coordinate
        });
        
        this.cancelAction();
    }

    buyUnit(unitId, x, y) {
        this.socket.emit('buy_unit', {
            gameId: this.gameId,
            playerId: this.playerId,
            cityX: x,
            cityY: y,
            unitId: unitId
        });
        
        this.cancelAction();
    }

    endTurn() {
        if (!this.isMyTurn()) {
            this.showNotification('Du bist nicht am Zug', 'warning');
            return;
        }
        
        this.socket.emit('end_turn', {
            gameId: this.gameId,
            playerId: this.playerId
        });
    }

    upgradeRace() {
        if (!this.isMyTurn()) {
            this.showNotification('Du bist nicht am Zug', 'warning');
            return;
        }
        
        this.socket.emit('upgrade_race', {
            gameId: this.gameId,
            playerId: this.playerId
        });
    }

    // UI Updates
    updateUI() {
        this.updatePlayerInfo();
        this.updateTurnInfo();
        this.updateActionButtons();
    }

    updatePlayerInfo() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;
        
        document.getElementById('playerName').textContent = player.player_name;
        document.getElementById('playerGold').textContent = player.gold;
        document.getElementById('playerRace').textContent = player.race_name;
        document.getElementById('playerLevel').textContent = player.race_level || 1;
    }

    updateTurnInfo() {
        if (!this.gameState) return;
        
        const currentPlayer = this.gameState.players.find(p => p.id === this.gameState.game.current_turn_player_id);
        const turnElement = document.getElementById('currentTurn');
        
        if (turnElement && currentPlayer) {
            turnElement.textContent = `${currentPlayer.player_name} ist am Zug`;
            turnElement.style.color = this.isMyTurn() ? '#2ecc71' : '#7f8c8d';
        }
        
        const turnNumberElement = document.getElementById('turnNumber');
        if (turnNumberElement) {
            turnNumberElement.textContent = this.gameState.game.turn_number || 1;
        }
    }

    updateActionButtons() {
        const moveBtn = document.getElementById('moveActionBtn');
        const attackBtn = document.getElementById('attackActionBtn');
        const buyBtn = document.getElementById('buyActionBtn');
        const endTurnBtn = document.getElementById('endTurnBtn');
        const upgradeBtn = document.getElementById('upgradeRaceBtn');
        
        const isMyTurn = this.isMyTurn();
        const hasSelectedUnit = this.selectedUnit && this.selectedUnit.player_id === this.playerId;
        const hasSelectedBuilding = this.selectedTile && this.gameState.map[this.selectedTile.x][this.selectedTile.y]?.owner_player_id === this.playerId;
        
        if (moveBtn) moveBtn.disabled = !isMyTurn || !hasSelectedUnit;
        if (attackBtn) attackBtn.disabled = !isMyTurn || !hasSelectedUnit;
        if (buyBtn) buyBtn.disabled = !isMyTurn || !hasSelectedBuilding;
        if (endTurnBtn) endTurnBtn.disabled = !isMyTurn;
        if (upgradeBtn) upgradeBtn.disabled = !isMyTurn;
    }

    // Hilfsfunktionen
    isMyTurn() {
        return this.gameState && this.gameState.game.current_turn_player_id === this.playerId;
    }

    isValidCoordinate(x, y) {
        return x >= 0 && y >= 0 && x < this.gameState.game.map_size && y < this.gameState.game.map_size;
    }

    isValidMovementPath() {
        if (!this.selectedUnit || this.movementPath.length < 2) return false;
        
        // Einfache Validierung - kann erweitert werden
        const pathCost = this.movementPath.length - 1; // Vereinfacht
        return pathCost <= (this.selectedUnit.movement_points_left || 0);
    }

    calculateMovementPath(from, to) {
        // Einfacher A* Pathfinding - kann verbessert werden
        const path = [from];
        
        let current = { ...from };
        while (current.x !== to.x || current.y !== to.y) {
            if (current.x < to.x) current.x++;
            else if (current.x > to.x) current.x--;
            else if (current.y < to.y) current.y++;
            else if (current.y > to.y) current.y--;
            
            path.push({ ...current });
            
            // Verhindere Endlosschleifen
            if (path.length > 50) break;
        }
        
        return path;
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    screenToWorld(screenPos) {
        return {
            x: (screenPos.x / this.zoomLevel) - this.mapOffset.x,
            y: (screenPos.y / this.zoomLevel) - this.mapOffset.y
        };
    }

    worldToTile(worldPos) {
        return {
            x: Math.floor(worldPos.x / this.tileSize),
            y: Math.floor(worldPos.y / this.tileSize)
        };
    }

    handleWheel(e) {
        e.preventDefault();
        
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        this.zoomLevel = Math.max(0.5, Math.min(3.0, this.zoomLevel * zoomFactor));
        
        this.render();
    }

    handleKeyDown(e) {
        switch (e.key) {
            case 'Escape':
                this.cancelAction();
                break;
            case ' ':
                if (this.isMyTurn()) {
                    this.endTurn();
                }
                break;
        }
    }

    setAction(action) {
        this.gameAction = action;
        this.movementPath = [];
        
        document.querySelectorAll('.action-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(action + 'ActionBtn')?.classList.add('active');
        
        this.render();
        console.log('Action set:', action);
    }

    cancelAction() {
        this.gameAction = null;
        this.movementPath = [];
        this.selectedUnit = null;
        this.selectedTile = null;
        
        document.querySelectorAll('.action-btn').forEach(btn => btn.classList.remove('active'));
        
        this.render();
        this.updateActionButtons();
    }

    showUnitInfo(unit) {
        const info = document.getElementById('unitInfo');
        if (info) {
            info.innerHTML = `
                <h4>${unit.unit_name}</h4>
                <p>❤️ Leben: ${unit.current_health}/${unit.max_health}</p>
                <p>⚔️ Angriff: ${unit.attack_power}</p>
                <p>📏 Reichweite: ${unit.attack_range}</p>
                <p>👣 Bewegung: ${unit.movement_points_left}/${unit.max_movement_points}</p>
                <p>🎯 Angegriffen: ${unit.has_attacked ? 'Ja' : 'Nein'}</p>
            `;
            info.style.display = 'block';
        }
    }

    showBuildingInfo(tile) {
        const info = document.getElementById('buildingInfo');
        if (info) {
            info.innerHTML = `
                <h4>${tile.building_name}</h4>
                <p>💰 Einkommen: ${tile.gold_income} Gold/Runde</p>
                <p>👤 Besitzer: ${tile.owner_name}</p>
            `;
            info.style.display = 'block';
        }
    }

    showUnitPurchaseDialog(x, y) {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player || !player.race_id) return;
        
        // Lade verfügbare Einheiten für die Rasse
        this.socket.emit('get_race_units', {
            raceId: player.race_id
        });
        
        // Dialog anzeigen (vereinfacht)
        const dialog = document.getElementById('unitPurchaseDialog');
        if (dialog) {
            dialog.style.display = 'block';
            dialog.dataset.x = x;
            dialog.dataset.y = y;
        }
    }

    showNotification(message, type = 'info') {
        console.log(`Notification [${type}]:`, message);
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        const container = document.getElementById('notifications') || document.body;
        container.appendChild(notification);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }

    showError(message) {
        this.showNotification(message, 'error');
    }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing game...');
    window.gameClient = new StrategyGameClient();
});