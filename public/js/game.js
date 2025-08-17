// public/js/game.js - Vollständige Spiellogik

class GameManager {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.gameState = null;
        this.playerName = '';
        this.currentPlayer = null;
        this.isMyTurn = false;
        
        // Rendering
        this.renderer = null;
        this.canvas = null;
        this.minimap = null;
        
        // Spielzustand
        this.selectedUnit = null;
        this.selectedBuilding = null;
        this.availableUnits = [];
        
        this.init();
    }

    init() {
        this.gameId = getGameIdFromUrl();
        if (!this.gameId) {
            showNotification('Keine gültige Spiel-ID gefunden', 'error');
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }

        this.playerName = loadFromLocalStorage('playerName', '');
        if (!this.playerName) {
            showNotification('Kein Spielername gefunden', 'error');
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }

        this.setupCanvas();
        this.setupSocket();
        this.setupEventListeners();
        this.showLoadingScreen('Verbinde mit Spiel...');
    }

    setupCanvas() {
        this.canvas = document.getElementById('gameMap');
        this.minimap = document.getElementById('minimap');
        
        if (!this.canvas || !this.minimap) {
            console.error('Canvas elements not found');
            return;
        }
        
        // Initialisiere Renderer
        this.renderer = new GameRenderer(this.canvas, this);
        
        // Canvas-Größe anpassen
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight - 100;
        
        if (this.renderer) {
            this.renderer.resize(this.canvas.width, this.canvas.height);
        }
    }

    setupSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to game server');
            this.joinGame();
        });

        this.socket.on('disconnect', () => {
            showNotification('Verbindung zum Server verloren', 'error');
        });

        this.socket.on('game_state', (gameState) => {
            this.updateGameState(gameState);
            this.hideLoadingScreen();
        });

        this.socket.on('turn_ended', (data) => {
            this.handleTurnEnd(data);
        });

        this.socket.on('unit_moved', (data) => {
            this.handleUnitMove(data);
        });

        this.socket.on('unit_attacked', (data) => {
            this.handleUnitAttack(data);
        });

        this.socket.on('unit_purchased', (data) => {
            this.handleUnitPurchase(data);
        });

        this.socket.on('building_captured', (data) => {
            this.handleBuildingCapture(data);
        });

        this.socket.on('player_eliminated', (data) => {
            this.handlePlayerElimination(data);
        });

        this.socket.on('game_ended', (data) => {
            this.handleGameEnd(data);
        });

        this.socket.on('error', (error) => {
            showNotification(error, 'error');
        });
    }

    setupEventListeners() {
        // UI-Buttons
        document.getElementById('endTurnBtn').addEventListener('click', () => this.endTurn());
        document.getElementById('leaveGameBtn').addEventListener('click', () => this.leaveGame());
        
        // Map-Steuerung
        document.getElementById('zoomInBtn').addEventListener('click', () => this.renderer.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.renderer.zoomOut());
        document.getElementById('centerMapBtn').addEventListener('click', () => this.centerOnOwnUnits());
        
        // Aktions-Buttons
        document.getElementById('moveUnitBtn').addEventListener('click', () => this.enterMoveMode());
        document.getElementById('attackBtn').addEventListener('click', () => this.enterAttackMode());
        document.getElementById('buildUnitBtn').addEventListener('click', () => this.showUnitPurchaseModal());
        
        // Minimap-Klick
        this.minimap.addEventListener('click', (e) => this.handleMinimapClick(e));
    }

    // Spiel beitreten
    joinGame() {
        this.socket.emit('join_db_game_room', {
            gameId: this.gameId,
            playerName: this.playerName
        });
        
        this.socket.emit('get_game_state', {
            gameId: this.gameId
        });
    }

    // Spielzustand aktualisieren
    updateGameState(gameState) {
        this.gameState = gameState;
        
        // Aktuellen Spieler finden
        this.currentPlayer = gameState.players.find(p => p.player_name === this.playerName);
        if (!this.currentPlayer) {
            showNotification('Spieler nicht im Spiel gefunden', 'error');
            return;
        }
        
        // Prüfen ob am Zug
        this.isMyTurn = gameState.game.current_turn_player_id === this.currentPlayer.id;
        
        // UI aktualisieren
        this.updateUI();
        
        // Renderer aktualisieren
        if (this.renderer) {
            this.renderer.updateGameState(gameState);
        }
        
        // Minimap aktualisieren
        this.updateMinimap();
        
        console.log('Game state updated:', gameState);
    }

    // UI aktualisieren
    updateUI() {
        if (!this.gameState || !this.currentPlayer) return;
        
        // Header-Informationen
        document.getElementById('currentTurn').textContent = this.gameState.game.turn_number;
        document.getElementById('playerGold').textContent = this.currentPlayer.gold;
        
        // Aktueller Spieler
        const currentTurnPlayer = this.gameState.players.find(p => p.id === this.gameState.game.current_turn_player_id);
        document.getElementById('currentPlayer').textContent = currentTurnPlayer ? currentTurnPlayer.player_name : 'Unbekannt';
        
        // Spielerliste
        this.updatePlayersList();
        
        // Turn-Button
        const endTurnBtn = document.getElementById('endTurnBtn');
        if (this.isMyTurn) {
            endTurnBtn.disabled = false;
            endTurnBtn.textContent = 'Zug beenden';
            endTurnBtn.style.backgroundColor = '#2ecc71';
        } else {
            endTurnBtn.disabled = true;
            endTurnBtn.textContent = 'Warte auf anderen Spieler';
            endTurnBtn.style.backgroundColor = '#95a5a6';
        }
        
        // Verfügbare Einheiten
        this.updateAvailableUnits();
    }

    updatePlayersList() {
        const playersContainer = document.getElementById('playersStatus');
        if (!playersContainer || !this.gameState) return;
        
        playersContainer.innerHTML = this.gameState.players.map(player => {
            const isCurrentTurn = player.id === this.gameState.game.current_turn_player_id;
            const unitCount = this.gameState.units.filter(u => u.player_id === player.id).length;
            const buildingCount = this.gameState.map.filter(m => m.owner_player_id === player.id && m.building_type_id).length;
            
            return `
                <div class="player-status ${isCurrentTurn ? 'active' : ''} ${!player.is_active ? 'eliminated' : ''}">
                    <div class="player-color" style="background-color: ${player.race_color}"></div>
                    <div class="player-info">
                        <div class="player-name">${player.player_name} ${isCurrentTurn ? '👑' : ''}</div>
                        <div class="player-stats">
                            ${player.race_name} | 💰${player.gold} | 🏰${buildingCount} | ⚔️${unitCount}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateAvailableUnits() {
        const unitsContainer = document.getElementById('availableUnits');
        if (!unitsContainer || !this.gameState) return;
        
        // Finde verfügbare Einheiten für die Spielerrasse
        const playerRace = this.currentPlayer.race_id;
        this.availableUnits = this.gameState.availableUnits.filter(unit => unit.race_id === playerRace);
        
        unitsContainer.innerHTML = this.availableUnits.map(unit => {
            const canAfford = this.currentPlayer.gold >= unit.cost;
            
            return `
                <div class="unit-card ${canAfford ? 'available' : 'unavailable'}" data-unit-id="${unit.id}">
                    <div class="unit-name">${unit.name}</div>
                    <div class="unit-cost">💰${unit.cost}</div>
                    <div class="unit-stats">
                        <small>⚔️${unit.attack_power} 💚${unit.health} 🏃${unit.movement_points} 🎯${unit.attack_range}</small>
                    </div>
                </div>
            `;
        }).join('');
        
        // Event-Listener für Einheiten-Karten
        unitsContainer.querySelectorAll('.unit-card.available').forEach(card => {
            card.addEventListener('click', () => {
                const unitId = parseInt(card.dataset.unitId);
                this.selectUnitType(unitId);
            });
        });
    }

    // Zug beenden
    endTurn() {
        if (!this.isMyTurn) {
            showNotification('Du bist nicht am Zug', 'warning');
            return;
        }
        
        this.socket.emit('end_turn', {
            gameId: this.gameId,
            playerId: this.currentPlayer.id
        });
        
        showNotification('Zug beendet...', 'info');
    }

    // Einheit bewegen
    moveUnit(unitId, targetX, targetY) {
        if (!this.isMyTurn) {
            showNotification('Du bist nicht am Zug', 'warning');
            return;
        }
        
        this.socket.emit('move_unit', {
            gameId: this.gameId,
            playerId: this.currentPlayer.id,
            unitId: unitId,
            targetX: targetX,
            targetY: targetY
        });
    }

    // Einheit angreifen
    attackUnit(attackerUnitId, targetX, targetY) {
        if (!this.isMyTurn) {
            showNotification('Du bist nicht am Zug', 'warning');
            return;
        }
        
        this.socket.emit('attack_unit', {
            gameId: this.gameId,
            playerId: this.currentPlayer.id,
            attackerUnitId: attackerUnitId,
            targetX: targetX,
            targetY: targetY
        });
    }

    // Einheit kaufen
    purchaseUnit(unitTypeId, buildingX, buildingY) {
        if (!this.isMyTurn) {
            showNotification('Du bist nicht am Zug', 'warning');
            return;
        }
        
        this.socket.emit('purchase_unit', {
            gameId: this.gameId,
            playerId: this.currentPlayer.id,
            unitTypeId: unitTypeId,
            buildingX: buildingX,
            buildingY: buildingY
        });
    }

    // Event-Handler
    handleTurnEnd(data) {
        showNotification(`${data.nextPlayer.name} ist jetzt am Zug`, 'info');
        
        if (data.isNewRound) {
            showNotification(`Neue Runde ${data.turnNumber} beginnt!`, 'success');
        }
        
        // Spielzustand neu laden
        this.socket.emit('get_game_state', { gameId: this.gameId });
    }

    handleUnitMove(data) {
        showNotification(`Einheit bewegt: (${data.fromX},${data.fromY}) → (${data.toX},${data.toY})`, 'success');
        
        // Spielzustand neu laden
        this.socket.emit('get_game_state', { gameId: this.gameId });
    }

    handleUnitAttack(data) {
        const attacker = data.attacker;
        const defender = data.defender;
        
        let message = `${attacker.name} greift ${defender.name} an! `;
        message += `Schaden: ${attacker.damage} vs ${defender.damage}`;
        
        if (defender.destroyed) {
            message += ` - ${defender.name} wurde zerstört!`;
        }
        if (attacker.destroyed) {
            message += ` - ${attacker.name} wurde im Gegenangriff zerstört!`;
        }
        
        showNotification(message, 'info');
        
        // Zeige Battle-Result Modal
        this.showBattleResult(data);
        
        // Spielzustand neu laden
        this.socket.emit('get_game_state', { gameId: this.gameId });
    }

    handleUnitPurchase(data) {
        showNotification(`${data.unit.name} gekauft für ${data.unit.cost} Gold`, 'success');
        
        // Spielzustand neu laden
        this.socket.emit('get_game_state', { gameId: this.gameId });
    }

    handleBuildingCapture(data) {
        if (data.captured) {
            showNotification(`Gebäude erobert!`, 'success');
        }
        
        // Spielzustand neu laden
        this.socket.emit('get_game_state', { gameId: this.gameId });
    }

    handlePlayerElimination(data) {
        showNotification(`${data.playerName} wurde eliminiert!`, 'warning');
        
        // Spielzustand neu laden
        this.socket.emit('get_game_state', { gameId: this.gameId });
    }

    handleGameEnd(data) {
        if (data.winner) {
            if (data.winner.player_name === this.playerName) {
                showNotification('🎉 Du hast gewonnen! 🎉', 'success');
            } else {
                showNotification(`${data.winner.player_name} hat gewonnen!`, 'info');
            }
        } else {
            showNotification('Spiel beendet - Unentschieden', 'info');
        }
        
        setTimeout(() => {
            this.showGameOverModal(data);
        }, 2000);
    }

    // UI-Hilfsfunktionen
    updateSelectedUnitInfo(unit) {
        const infoContainer = document.getElementById('selectedUnitInfo');
        if (!infoContainer) return;
        
        if (unit) {
            infoContainer.innerHTML = `
                <h4>${unit.unit_name}</h4>
                <div class="unit-details">
                    <p><strong>Besitzer:</strong> ${unit.player_name}</p>
                    <p><strong>Position:</strong> (${unit.x_coordinate}, ${unit.y_coordinate})</p>
                    <p><strong>Gesundheit:</strong> ${unit.current_health}/${unit.max_health}</p>
                    <p><strong>Bewegung:</strong> ${unit.movement_points_left}/${unit.max_movement_points}</p>
                    <p><strong>Angriff:</strong> ${unit.attack_power} (Reichweite: ${unit.attack_range})</p>
                    <p><strong>Angegriffen:</strong> ${unit.has_attacked ? 'Ja' : 'Nein'}</p>
                </div>
            `;
            
            // Aktions-Buttons aktivieren/deaktivieren
            const isOwnUnit = unit.player_id === this.currentPlayer.id;
            const canMove = isOwnUnit && this.isMyTurn && unit.movement_points_left > 0;
            const canAttack = isOwnUnit && this.isMyTurn && !unit.has_attacked;
            
            document.getElementById('moveUnitBtn').disabled = !canMove;
            document.getElementById('attackBtn').disabled = !canAttack;
        } else {
            infoContainer.innerHTML = '<p>Wähle eine Einheit aus</p>';
            document.getElementById('moveUnitBtn').disabled = true;
            document.getElementById('attackBtn').disabled = true;
        }
    }

    clearSelectedUnitInfo() {
        this.updateSelectedUnitInfo(null);
    }

    updateHoverInfo(info) {
        const hoverInfo = document.getElementById('hoveredTileInfo');
        if (hoverInfo) {
            hoverInfo.textContent = info;
        }
    }

    // Modals
    showBattleResult(battleData) {
        const modal = document.getElementById('battleResultModal');
        const resultContainer = document.getElementById('battleResult');
        
        if (!modal || !resultContainer) return;
        
        const attacker = battleData.attacker;
        const defender = battleData.defender;
        
        resultContainer.innerHTML = `
            <div class="battle-summary">
                <h4>Kampf Ergebnis</h4>
                <div class="battle-participants">
                    <div class="battle-unit">
                        <h5>Angreifer: ${attacker.name}</h5>
                        <p>Schaden verursacht: ${attacker.damage}</p>
                        <p>Verbleibende HP: ${attacker.newHealth}</p>
                        ${attacker.destroyed ? '<p class="destroyed">💀 Zerstört</p>' : ''}
                    </div>
                    <div class="vs">VS</div>
                    <div class="battle-unit">
                        <h5>Verteidiger: ${defender.name}</h5>
                        <p>Schaden verursacht: ${defender.damage}</p>
                        <p>Verbleibende HP: ${defender.newHealth}</p>
                        ${defender.destroyed ? '<p class="destroyed">💀 Zerstört</p>' : ''}
                    </div>
                </div>
            </div>
        `;
        
        showModal('battleResultModal');
        
        // Auto-close nach 5 Sekunden
        setTimeout(() => {
            hideModal('battleResultModal');
        }, 5000);
    }

    showGameOverModal(gameData) {
        const modal = document.getElementById('gameOverModal');
        const resultContainer = document.getElementById('gameOverResult');
        
        if (!modal || !resultContainer) return;
        
        let content = '<h4>Spiel beendet!</h4>';
        
        if (gameData.winner) {
            content += `<p class="winner">🏆 Gewinner: ${gameData.winner.player_name}</p>`;
        } else {
            content += '<p>Unentschieden</p>';
        }
        
        if (gameData.eliminatedPlayers && gameData.eliminatedPlayers.length > 0) {
            content += '<h5>Eliminierte Spieler:</h5><ul>';
            gameData.eliminatedPlayers.forEach(player => {
                content += `<li>${player.player_name}</li>`;
            });
            content += '</ul>';
        }
        
        resultContainer.innerHTML = content;
        showModal('gameOverModal');
    }

    showUnitPurchaseModal() {
        // Prüfe ob ein eigenes Gebäude ausgewählt ist
        if (!this.selectedBuilding || this.selectedBuilding.owner_player_id !== this.currentPlayer.id) {
            showNotification('Wähle zuerst ein eigenes Gebäude aus', 'warning');
            return;
        }
        
        const modal = document.getElementById('unitPurchaseModal');
        const infoContainer = document.getElementById('purchaseUnitInfo');
        
        if (!modal || !infoContainer) return;
        
        // Zeige verfügbare Einheiten
        infoContainer.innerHTML = this.availableUnits.map(unit => {
            const canAfford = this.currentPlayer.gold >= unit.cost;
            
            return `
                <div class="purchase-unit-option ${canAfford ? 'affordable' : 'expensive'}" data-unit-id="${unit.id}">
                    <h5>${unit.name}</h5>
                    <p>Kosten: ${unit.cost} Gold</p>
                    <p>Angriff: ${unit.attack_power} | HP: ${unit.health} | Bewegung: ${unit.movement_points}</p>
                    <p>Reichweite: ${unit.attack_range}</p>
                    <button class="btn btn-small ${canAfford ? 'btn-success' : 'btn-secondary'}" 
                            ${canAfford ? '' : 'disabled'} 
                            onclick="gameManager.confirmUnitPurchase(${unit.id})">
                        ${canAfford ? 'Kaufen' : 'Zu teuer'}
                    </button>
                </div>
            `;
        }).join('');
        
        showModal('unitPurchaseModal');
    }

    confirmUnitPurchase(unitTypeId) {
        if (!this.selectedBuilding) {
            showNotification('Kein Gebäude ausgewählt', 'error');
            return;
        }
        
        this.purchaseUnit(unitTypeId, this.selectedBuilding.x_coordinate, this.selectedBuilding.y_coordinate);
        hideModal('unitPurchaseModal');
    }

    // Minimap
    updateMinimap() {
        if (!this.renderer || !this.minimap) return;
        this.renderer.renderMinimap(this.minimap);
    }

    handleMinimapClick(e) {
        const rect = this.minimap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const mapSize = this.gameState?.game?.map_size || 30;
        const tileX = Math.floor((x / this.minimap.width) * mapSize);
        const tileY = Math.floor((y / this.minimap.height) * mapSize);
        
        if (this.renderer) {
            this.renderer.centerOnTile(tileX, tileY);
        }
    }

    // Weitere Hilfsfunktionen
    centerOnOwnUnits() {
        if (!this.gameState || !this.currentPlayer) return;
        
        const ownUnits = this.gameState.units.filter(unit => unit.player_id === this.currentPlayer.id);
        if (ownUnits.length === 0) return;
        
        // Berechne Zentrum der eigenen Einheiten
        const centerX = ownUnits.reduce((sum, unit) => sum + unit.x_coordinate, 0) / ownUnits.length;
        const centerY = ownUnits.reduce((sum, unit) => sum + unit.y_coordinate, 0) / ownUnits.length;
        
        if (this.renderer) {
            this.renderer.centerOnTile(Math.floor(centerX), Math.floor(centerY));
        }
    }

    selectUnitType(unitId) {
        // Markiere ausgewählten Einheiten-Typ
        document.querySelectorAll('.unit-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        const selectedCard = document.querySelector(`[data-unit-id="${unitId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
        }
    }

    enterMoveMode() {
        showNotification('Klicke auf ein Zielfeld um die Einheit zu bewegen', 'info');
        // TODO: Visueller Indikator für Bewegungsmodus
    }

    enterAttackMode() {
        showNotification('Klicke auf eine gegnerische Einheit um anzugreifen', 'info');
        // TODO: Visueller Indikator für Angriffsmodus
    }

    leaveGame() {
        if (confirm('Möchtest du das Spiel wirklich verlassen?')) {
            window.location.href = '/';
        }
    }

    // Loading/Error Handling
    showLoadingScreen(message) {
        const loadingScreen = document.getElementById('loadingScreen');
        const loadingStatus = document.getElementById('loadingStatus');
        
        if (loadingScreen) {
            loadingScreen.style.display = 'flex';
        }
        if (loadingStatus && message) {
            loadingStatus.textContent = message;
        }
    }

    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }
    }

    // Benachrichtigungen
    showNotification(message, type = 'info') {
        // Verwende die globale showNotification Funktion
        if (typeof showNotification === 'function') {
            showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Event-Listener für Modal-Buttons
document.addEventListener('DOMContentLoaded', () => {
    // Battle Result Modal
    const closeBattleBtn = document.getElementById('closeBattleBtn');
    if (closeBattleBtn) {
        closeBattleBtn.addEventListener('click', () => {
            hideModal('battleResultModal');
        });
    }
    
    // Game Over Modal
    const backToLobbyBtn = document.getElementById('backToLobbyBtn');
    if (backToLobbyBtn) {
        backToLobbyBtn.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
    
    // Unit Purchase Modal
    const cancelPurchaseBtn = document.getElementById('cancelPurchaseBtn');
    if (cancelPurchaseBtn) {
        cancelPurchaseBtn.addEventListener('click', () => {
            hideModal('unitPurchaseModal');
        });
    }
    
    // Initialisiere GameManager
    window.gameManager = new GameManager();
});

// Export für Module (falls benötigt)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameManager;
}