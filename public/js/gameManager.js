// public/js/gameManager.js
// Client-seitiger Spiel-Manager für Turn-Management und UI

class GameManager {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.playerName = null;
        this.currentPlayer = null;
        this.gameState = null;
        this.selectedUnit = null;
        this.gameRenderer = null;
        this.isMyTurn = false;
        
        // UI Elemente
        this.elements = {};
        
        // Aktions-Modi
        this.actionMode = 'none'; // 'none', 'move', 'attack', 'buy'
        this.possibleMoves = [];
        this.possibleAttacks = [];
        this.purchaseMode = false;
        
        this.init();
    }

    init() {
        console.log('🎮 Initializing Game Manager...');
        
        // URL Parameter parsen
        this.parseUrlParameters();
        
        if (!this.gameId || !this.playerName) {
            this.showError('Ungültige Spielparameter');
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }

        // Socket initialisieren
        this.initSocket();
        
        // UI Elemente cachen
        this.cacheUIElements();
        
        // Event Listeners
        this.setupEventListeners();
        
        // Game Renderer initialisieren
        this.gameRenderer = new GameRenderer(this);
        
        // Dem Spiel beitreten
        this.joinGame();
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
        
        // Socket Events
        this.socket.on('connect', () => {
            console.log('✅ Socket connected');
            this.hideLoadingScreen();
        });

        this.socket.on('disconnect', () => {
            console.log('📡 Socket disconnected');
            this.showError('Verbindung verloren');
        });

        // Spiel Events
        this.socket.on('game_state_updated', (data) => {
            console.log('Game state updated:', data);
            this.handleGameStateUpdate(data);
        });

        this.socket.on('turn_started', (data) => {
            console.log('Turn started:', data);
            this.handleTurnStarted(data);
        });

        this.socket.on('unit_moved', (data) => {
            console.log('Unit moved:', data);
            this.handleUnitMoved(data);
        });

        this.socket.on('unit_attacked', (data) => {
            console.log('Unit attacked:', data);
            this.handleUnitAttacked(data);
        });

        this.socket.on('unit_purchased', (data) => {
            console.log('Unit purchased:', data);
            this.handleUnitPurchased(data);
        });

        this.socket.on('turn_ended', (data) => {
            console.log('Turn ended:', data);
            this.handleTurnEnded(data);
        });

        this.socket.on('game_ended', (data) => {
            console.log('Game ended:', data);
            this.handleGameEnded(data);
        });

        this.socket.on('action_result', (data) => {
            console.log('Action result:', data);
            this.handleActionResult(data);
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            this.showError(error.message || 'Unbekannter Fehler');
        });
    }

    cacheUIElements() {
        this.elements = {
            // Loading
            loadingScreen: document.getElementById('loadingScreen'),
            gameContainer: document.getElementById('gameContainer'),
            
            // Game Info
            gameName: document.getElementById('gameName'),
            turnNumber: document.getElementById('turnNumber'),
            mapSize: document.getElementById('mapSize'),
            currentPlayerSpan: document.getElementById('currentPlayer'),
            
            // Player Stats
            playerGold: document.getElementById('playerGold'),
            playerCities: document.getElementById('playerCities'),
            playerCastles: document.getElementById('playerCastles'),
            playerUnits: document.getElementById('playerUnits'),
            
            // Players List
            playersList: document.getElementById('playersList'),
            
            // Action Buttons
            endTurnBtn: document.getElementById('endTurnBtn'),
            buyUnitBtn: document.getElementById('buyUnitBtn'),
            upgradeLevelBtn: document.getElementById('upgradeLevelBtn'),
            
            // Game Canvas
            gameCanvas: document.getElementById('gameCanvas'),
            
            // Selected Unit Info
            selectedUnitInfo: document.getElementById('selectedUnitInfo'),
            
            // Action Panel
            actionPanel: document.getElementById('actionPanel'),
            
            // Notifications
            notifications: document.getElementById('notifications')
        };
    }

    setupEventListeners() {
        // End Turn Button
        if (this.elements.endTurnBtn) {
            this.elements.endTurnBtn.addEventListener('click', () => {
                this.endTurn();
            });
        }

        // Buy Unit Button
        if (this.elements.buyUnitBtn) {
            this.elements.buyUnitBtn.addEventListener('click', () => {
                this.togglePurchaseMode();
            });
        }

        // Upgrade Level Button
        if (this.elements.upgradeLevelBtn) {
            this.elements.upgradeLevelBtn.addEventListener('click', () => {
                this.upgradeLevel();
            });
        }

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardInput(e);
        });
    }

    // Spiel beitreten
    joinGame() {
        console.log(`🎮 Joining game ${this.gameId} as ${this.playerName}`);
        
        this.socket.emit('join_game_room', {
            gameId: this.gameId,
            playerName: this.playerName
        });
    }

    // Game State Update Handler
    handleGameStateUpdate(data) {
        this.gameState = data.gameState;
        this.updateCurrentPlayer();
        this.updateUI();
        
        if (this.gameRenderer) {
            this.gameRenderer.updateGameState(this.gameState);
        }
    }

    // Turn Started Handler
    handleTurnStarted(data) {
        this.isMyTurn = data.isMyTurn;
        
        if (this.isMyTurn) {
            this.showNotification(`Dein Zug! Du erhältst ${data.goldIncome} Gold.`, 'success');
            this.enableTurnActions();
        } else {
            this.showNotification(`${data.currentPlayerName} ist am Zug`, 'info');
            this.disableTurnActions();
        }
        
        this.updateUI();
    }

    // Unit Movement Handler
    handleUnitMoved(data) {
        if (data.success) {
            this.showNotification(`Einheit bewegt von (${data.fromX},${data.fromY}) nach (${data.toX},${data.toY})`, 'success');
            this.clearSelection();
        } else {
            this.showNotification(data.message, 'error');
        }
    }

    // Unit Attack Handler
    handleUnitAttacked(data) {
        if (data.success) {
            const message = data.targetDestroyed 
                ? `${data.targetName} vernichtet! (${data.damage} Schaden)`
                : `${data.targetName} getroffen! (${data.damage} Schaden, ${data.targetNewHealth} LP übrig)`;
            this.showNotification(message, data.targetDestroyed ? 'success' : 'warning');
            this.clearSelection();
        } else {
            this.showNotification(data.message, 'error');
        }
    }

    // Unit Purchase Handler
    handleUnitPurchased(data) {
        if (data.success) {
            this.showNotification(`${data.unitName} für ${data.cost} Gold gekauft`, 'success');
            this.purchaseMode = false;
            this.updatePurchaseMode();
        } else {
            this.showNotification(data.message, 'error');
        }
    }

    // Turn End Handler
    handleTurnEnded(data) {
        this.isMyTurn = false;
        this.disableTurnActions();
        this.clearSelection();
        this.showNotification(`${data.nextPlayerName} ist jetzt am Zug`, 'info');
    }

    // Game End Handler
    handleGameEnded(data) {
        this.disableTurnActions();
        
        if (data.winner) {
            const message = data.winner.player_name === this.playerName 
                ? 'Gratulation! Du hast gewonnen!' 
                : `Spiel beendet. ${data.winner.player_name} hat gewonnen.`;
            this.showNotification(message, data.winner.player_name === this.playerName ? 'success' : 'info');
        } else {
            this.showNotification('Spiel beendet - Unentschieden', 'info');
        }
        
        // Zurück zur Lobby nach 10 Sekunden
        setTimeout(() => {
            window.location.href = '/';
        }, 10000);
    }

    // Action Result Handler
    handleActionResult(data) {
        if (data.success) {
            this.showNotification(data.message, 'success');
        } else {
            this.showNotification(data.message, 'error');
        }
    }

    // Aktuellen Spieler aktualisieren
    updateCurrentPlayer() {
        if (!this.gameState || !this.gameState.players) return;
        
        this.currentPlayer = this.gameState.players.find(p => p.player_name === this.playerName);
        this.isMyTurn = this.gameState.game.current_turn_player_id === this.currentPlayer?.id;
    }

    // UI Update
    updateUI() {
        if (!this.gameState) return;
        
        const game = this.gameState.game;
        
        // Game Info
        if (this.elements.gameName) this.elements.gameName.textContent = game.name || 'Strategiespiel';
        if (this.elements.turnNumber) this.elements.turnNumber.textContent = game.turn_number || 1;
        if (this.elements.mapSize) this.elements.mapSize.textContent = `${game.map_size}x${game.map_size}`;
        
        // Current Player
        const currentPlayerData = this.gameState.players.find(p => p.id === game.current_turn_player_id);
        if (this.elements.currentPlayerSpan && currentPlayerData) {
            this.elements.currentPlayerSpan.textContent = currentPlayerData.player_name;
            this.elements.currentPlayerSpan.style.color = currentPlayerData.race_color || '#333';
        }
        
        // Player Stats
        if (this.currentPlayer) {
            if (this.elements.playerGold) this.elements.playerGold.textContent = this.currentPlayer.gold || 0;
            
            // Zähle Gebäude und Einheiten
            const cities = this.gameState.map?.filter(tile => 
                tile.building_name === 'Stadt' && tile.owner_player_id === this.currentPlayer.id
            ).length || 0;
            
            const castles = this.gameState.map?.filter(tile => 
                tile.building_name === 'Burg' && tile.owner_player_id === this.currentPlayer.id
            ).length || 0;
            
            const units = this.gameState.units?.filter(unit => 
                unit.player_id === this.currentPlayer.id
            ).length || 0;
            
            if (this.elements.playerCities) this.elements.playerCities.textContent = cities;
            if (this.elements.playerCastles) this.elements.playerCastles.textContent = castles;
            if (this.elements.playerUnits) this.elements.playerUnits.textContent = units;
        }
        
        // Players List
        this.updatePlayersList();
        
        // Action Buttons
        this.updateActionButtons();
    }

    // Players List aktualisieren
    updatePlayersList() {
        if (!this.elements.playersList || !this.gameState?.players) return;
        
        this.elements.playersList.innerHTML = '';
        
        this.gameState.players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-item';
            
            if (player.id === this.gameState.game.current_turn_player_id) {
                playerDiv.classList.add('current-turn');
            }
            
            playerDiv.innerHTML = `
                <div class="player-color" style="background-color: ${player.race_color || '#666'}"></div>
                <div class="player-info">
                    <div class="player-name">${player.player_name}</div>
                    <div class="player-race">${player.race_name}</div>
                </div>
                <div class="player-stats">
                    <span>💰${player.gold}</span>
                </div>
            `;
            
            this.elements.playersList.appendChild(playerDiv);
        });
    }

    // Action Buttons aktualisieren
    updateActionButtons() {
        const isMyTurn = this.isMyTurn;
        
        if (this.elements.endTurnBtn) {
            this.elements.endTurnBtn.disabled = !isMyTurn;
            this.elements.endTurnBtn.style.opacity = isMyTurn ? '1' : '0.5';
        }
        
        if (this.elements.buyUnitBtn) {
            this.elements.buyUnitBtn.disabled = !isMyTurn;
            this.elements.buyUnitBtn.style.opacity = isMyTurn ? '1' : '0.5';
        }
        
        if (this.elements.upgradeLevelBtn) {
            this.elements.upgradeLevelBtn.disabled = !isMyTurn;
            this.elements.upgradeLevelBtn.style.opacity = isMyTurn ? '1' : '0.5';
        }
    }

    // Turn Actions aktivieren/deaktivieren
    enableTurnActions() {
        this.updateActionButtons();
        if (this.gameRenderer) {
            this.gameRenderer.enableInteraction();
        }
    }

    disableTurnActions() {
        this.clearSelection();
        this.actionMode = 'none';
        this.purchaseMode = false;
        this.updateActionButtons();
        this.updatePurchaseMode();
        if (this.gameRenderer) {
            this.gameRenderer.disableInteraction();
        }
    }

    // Spieler-Aktionen
    moveUnit(unitId, targetX, targetY) {
        if (!this.isMyTurn) {
            this.showNotification('Du bist nicht am Zug', 'error');
            return;
        }
        
        console.log(`Moving unit ${unitId} to (${targetX}, ${targetY})`);
        
        this.socket.emit('move_unit', {
            gameId: this.gameId,
            unitId: unitId,
            targetX: targetX,
            targetY: targetY
        });
    }

    attackUnit(attackerUnitId, targetX, targetY) {
        if (!this.isMyTurn) {
            this.showNotification('Du bist nicht am Zug', 'error');
            return;
        }
        
        console.log(`Unit ${attackerUnitId} attacking (${targetX}, ${targetY})`);
        
        this.socket.emit('attack_unit', {
            gameId: this.gameId,
            attackerUnitId: attackerUnitId,
            targetX: targetX,
            targetY: targetY
        });
    }

    buyUnit(buildingX, buildingY, unitId) {
        if (!this.isMyTurn) {
            this.showNotification('Du bist nicht am Zug', 'error');
            return;
        }
        
        console.log(`Buying unit ${unitId} at (${buildingX}, ${buildingY})`);
        
        this.socket.emit('buy_unit', {
            gameId: this.gameId,
            buildingX: buildingX,
            buildingY: buildingY,
            unitId: unitId
        });
    }

    upgradeLevel() {
        if (!this.isMyTurn) {
            this.showNotification('Du bist nicht am Zug', 'error');
            return;
        }
        
        console.log('Upgrading player level');
        
        this.socket.emit('upgrade_level', {
            gameId: this.gameId
        });
    }

    endTurn() {
        if (!this.isMyTurn) {
            this.showNotification('Du bist nicht am Zug', 'error');
            return;
        }
        
        console.log('Ending turn');
        
        this.socket.emit('end_turn', {
            gameId: this.gameId
        });
    }

    // Purchase Mode Toggle
    togglePurchaseMode() {
        this.purchaseMode = !this.purchaseMode;
        this.updatePurchaseMode();
        
        if (this.purchaseMode) {
            this.showNotification('Einheitenkauf-Modus aktiviert. Klicke auf ein eigenes Gebäude.', 'info');
        } else {
            this.showNotification('Einheitenkauf-Modus deaktiviert', 'info');
        }
    }

    updatePurchaseMode() {
        if (this.elements.buyUnitBtn) {
            this.elements.buyUnitBtn.textContent = this.purchaseMode ? 'Kauf beenden' : 'Einheit kaufen';
            this.elements.buyUnitBtn.classList.toggle('btn-danger', this.purchaseMode);
            this.elements.buyUnitBtn.classList.toggle('btn-primary', !this.purchaseMode);
        }
        
        if (this.gameRenderer) {
            this.gameRenderer.setPurchaseMode(this.purchaseMode);
        }
    }

    // Selection Management
    clearSelection() {
        this.selectedUnit = null;
        this.possibleMoves = [];
        this.possibleAttacks = [];
        this.actionMode = 'none';
        
        if (this.gameRenderer) {
            this.gameRenderer.clearSelection();
        }
        
        this.updateSelectedUnitInfo();
    }

    selectUnit(unit) {
        if (!this.isMyTurn) return;
        
        this.selectedUnit = unit;
        this.calculatePossibleActions();
        this.updateSelectedUnitInfo();
        
        if (this.gameRenderer) {
            this.gameRenderer.setSelectedUnit(unit);
        }
    }

    calculatePossibleActions() {
        if (!this.selectedUnit) return;
        
        // TODO: Implementiere Bewegungsberechnung
        this.possibleMoves = [];
        this.possibleAttacks = [];
    }

    updateSelectedUnitInfo() {
        const infoDiv = this.elements.selectedUnitInfo;
        if (!infoDiv) return;
        
        if (!this.selectedUnit) {
            infoDiv.innerHTML = '<p>Keine Einheit ausgewählt</p>';
            return;
        }
        
        const unit = this.selectedUnit;
        infoDiv.innerHTML = `
            <div class="selected-unit-card">
                <h4>${unit.unit_name}</h4>
                <div class="unit-stats">
                    <div class="stat">
                        <span class="stat-icon">❤️</span>
                        <span>${unit.current_health}/${unit.max_health}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-icon">⚔️</span>
                        <span>${unit.attack_power}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-icon">🏃</span>
                        <span>${unit.movement_points_left}/${unit.max_movement_points}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-icon">🎯</span>
                        <span>${unit.attack_range}</span>
                    </div>
                </div>
                <div class="unit-actions">
                    <button class="btn btn-small btn-primary" ${!unit.movement_points_left ? 'disabled' : ''} onclick="gameManager.setActionMode('move')">
                        Bewegen
                    </button>
                    <button class="btn btn-small btn-danger" ${unit.has_attacked ? 'disabled' : ''} onclick="gameManager.setActionMode('attack')">
                        Angreifen
                    </button>
                </div>
            </div>
        `;
    }

    setActionMode(mode) {
        this.actionMode = mode;
        
        if (mode === 'move') {
            this.showNotification('Bewegung: Klicke auf ein Zielfeld', 'info');
        } else if (mode === 'attack') {
            this.showNotification('Angriff: Klicke auf eine feindliche Einheit', 'info');
        }
        
        if (this.gameRenderer) {
            this.gameRenderer.setActionMode(mode);
        }
    }

    // Tile Click Handler (vom Renderer aufgerufen)
    onTileClick(tileX, tileY, tile, unit) {
        if (!this.isMyTurn) return;
        
        if (this.purchaseMode) {
            this.handlePurchaseClick(tileX, tileY, tile);
        } else if (this.selectedUnit) {
            this.handleUnitAction(tileX, tileY, unit);
        } else if (unit && unit.player_id === this.currentPlayer?.id) {
            this.selectUnit(unit);
        }
    }

    handlePurchaseClick(tileX, tileY, tile) {
        if (tile.building_type_id && tile.owner_player_id === this.currentPlayer?.id) {
            this.showUnitPurchaseDialog(tileX, tileY);
        } else {
            this.showNotification('Du kannst nur in deinen eigenen Gebäuden Einheiten kaufen', 'error');
        }
    }

    handleUnitAction(tileX, tileY, targetUnit) {
        if (this.actionMode === 'move') {
            this.moveUnit(this.selectedUnit.id, tileX, tileY);
        } else if (this.actionMode === 'attack' && targetUnit) {
            this.attackUnit(this.selectedUnit.id, tileX, tileY);
        } else {
            this.showNotification('Wähle eine Aktion aus oder klicke auf eine gültige Position', 'warning');
        }
    }

    showUnitPurchaseDialog(buildingX, buildingY) {
        // TODO: Implementiere Unit Purchase Dialog
        console.log(`Show purchase dialog for building at (${buildingX}, ${buildingY})`);
    }

    // Keyboard Input Handler
    handleKeyboardInput(event) {
        if (!this.isMyTurn) return;
        
        switch (event.key.toLowerCase()) {
            case 'escape':
                this.clearSelection();
                if (this.purchaseMode) {
                    this.togglePurchaseMode();
                }
                break;
            case ' ':
            case 'enter':
                if (this.isMyTurn) {
                    this.endTurn();
                }
                break;
            case 'm':
                if (this.selectedUnit) {
                    this.setActionMode('move');
                }
                break;
            case 'a':
                if (this.selectedUnit) {
                    this.setActionMode('attack');
                }
                break;
            case 'b':
                this.togglePurchaseMode();
                break;
        }
    }

    // Utility Methods
    showNotification(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        if (!this.elements.notifications) return;
        
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        this.elements.notifications.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    hideLoadingScreen() {
        if (this.elements.loadingScreen) {
            this.elements.loadingScreen.style.display = 'none';
        }
        if (this.elements.gameContainer) {
            this.elements.gameContainer.style.display = 'flex';
        }
    }
}

// Global instance
let gameManager = null;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    gameManager = new GameManager();
});

// Export for use by other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameManager;
}