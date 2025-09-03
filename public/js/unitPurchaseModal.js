// public/js/unitPurchaseModal.js
// Modal für Einheitenkauf

class UnitPurchaseModal {
    constructor(gameManager) {
        this.gameManager = gameManager;
        this.modal = null;
        this.availableUnits = [];
        this.selectedBuilding = null;
        this.playerGold = 0;
        
        this.createModal();
        this.setupEventListeners();
    }

    createModal() {
        // Modal HTML erstellen
        const modalHTML = `
            <div id="unitPurchaseModal" class="modal" style="display: none;">
                <div class="modal-content unit-purchase-content">
                    <div class="modal-header">
                        <h3>Einheiten kaufen</h3>
                        <button class="close-btn" id="closePurchaseModal">&times;</button>
                    </div>
                    
                    <div class="modal-body">
                        <div class="purchase-info">
                            <div class="building-info">
                                <h4 id="buildingName">Gebäude</h4>
                                <p id="buildingLocation">Position: (0, 0)</p>
                            </div>
                            <div class="player-gold">
                                <span class="gold-icon">💰</span>
                                <span id="modalPlayerGold">0</span> Gold
                            </div>
                        </div>
                        
                        <div class="units-grid" id="purchaseUnitsGrid">
                            <!-- Einheiten werden hier geladen -->
                        </div>
                        
                        <div class="purchase-actions">
                            <button id="confirmPurchaseBtn" class="btn btn-success" disabled>
                                Kaufen
                            </button>
                            <button id="cancelPurchaseBtn" class="btn btn-secondary">
                                Abbrechen
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Modal zum DOM hinzufügen
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('unitPurchaseModal');
    }

    setupEventListeners() {
        // Modal schließen
        document.getElementById('closePurchaseModal').addEventListener('click', () => {
            this.hide();
        });

        document.getElementById('cancelPurchaseBtn').addEventListener('click', () => {
            this.hide();
        });

        // Modal schließen bei Klick außerhalb
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        });

        // Bestätigen Button
        document.getElementById('confirmPurchaseBtn').addEventListener('click', () => {
            this.confirmPurchase();
        });

        // ESC-Taste
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.style.display === 'flex') {
                this.hide();
            }
        });
    }

    show(buildingX, buildingY, buildingName = 'Gebäude') {
        this.selectedBuilding = { x: buildingX, y: buildingY, name: buildingName };
        this.selectedUnitId = null;
        
        // Gebäude-Info aktualisieren
        document.getElementById('buildingName').textContent = buildingName;
        document.getElementById('buildingLocation').textContent = `Position: (${buildingX}, ${buildingY})`;
        
        // Aktuelles Gold anzeigen
        this.updatePlayerGold();
        
        // Verfügbare Einheiten laden
        this.loadAvailableUnits();
        
        // Modal anzeigen
        this.modal.style.display = 'flex';
        
        console.log(`📦 Opening unit purchase modal for ${buildingName} at (${buildingX}, ${buildingY})`);
    }

    hide() {
        this.modal.style.display = 'none';
        this.selectedBuilding = null;
        this.selectedUnitId = null;
        this.availableUnits = [];
        
        // Bestätigen-Button zurücksetzen
        document.getElementById('confirmPurchaseBtn').disabled = true;
    }

    updatePlayerGold() {
        if (this.gameManager.currentPlayer) {
            this.playerGold = this.gameManager.currentPlayer.gold || 0;
            document.getElementById('modalPlayerGold').textContent = this.playerGold;
        }
    }

    loadAvailableUnits() {
        // Über Socket verfügbare Einheiten anfragen
        this.gameManager.socket.emit('get_available_units', {
            gameId: this.gameManager.gameId
        });

        // Event Listener für Antwort (temporär)
        const handleAvailableUnits = (data) => {
            this.availableUnits = data.units || [];
            this.renderUnits();
            
            // Event Listener entfernen
            this.gameManager.socket.off('available_units', handleAvailableUnits);
        };

        this.gameManager.socket.on('available_units', handleAvailableUnits);
    }

    renderUnits() {
        const unitsGrid = document.getElementById('purchaseUnitsGrid');
        unitsGrid.innerHTML = '';

        if (this.availableUnits.length === 0) {
            unitsGrid.innerHTML = '<p class="no-units">Keine Einheiten verfügbar</p>';
            return;
        }

        this.availableUnits.forEach(unit => {
            const canAfford = this.playerGold >= unit.cost;
            const levelMultiplier = 1 + ((unit.player_level - 1) * 0.2);
            
            // Berechnete Stats für aktuelles Level
            const adjustedHealth = Math.floor(unit.health * levelMultiplier);
            const adjustedAttack = Math.floor(unit.attack_power * levelMultiplier);
            const adjustedRange = unit.attack_range + Math.floor((unit.player_level - 1) * 0.5);

            const unitCard = document.createElement('div');
            unitCard.className = `unit-purchase-card ${canAfford ? 'affordable' : 'too-expensive'}`;
            unitCard.dataset.unitId = unit.id;

            unitCard.innerHTML = `
                <div class="unit-header">
                    <h5 class="unit-name">${unit.name}</h5>
                    <div class="unit-cost">
                        <span class="cost-value">${unit.cost}</span>
                        <span class="gold-icon">💰</span>
                    </div>
                </div>
                
                <div class="unit-stats">
                    <div class="stat-row">
                        <div class="stat">
                            <span class="stat-icon">❤️</span>
                            <span class="stat-value">${adjustedHealth}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-icon">⚔️</span>
                            <span class="stat-value">${adjustedAttack}</span>
                        </div>
                    </div>
                    <div class="stat-row">
                        <div class="stat">
                            <span class="stat-icon">🏃</span>
                            <span class="stat-value">${unit.movement_points}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-icon">🎯</span>
                            <span class="stat-value">${adjustedRange}</span>
                        </div>
                    </div>
                </div>
                
                ${unit.description ? `<div class="unit-description">${unit.description}</div>` : ''}
                
                ${unit.player_level > 1 ? `
                    <div class="level-bonus">
                        <small>Level ${unit.player_level} Bonus (+${((unit.player_level - 1) * 20)}%)</small>
                    </div>
                ` : ''}
                
                ${!canAfford ? '<div class="not-affordable">Nicht genug Gold</div>' : ''}
            `;

            // Click Event
            if (canAfford) {
                unitCard.addEventListener('click', () => {
                    this.selectUnit(unit.id);
                });
            }

            unitsGrid.appendChild(unitCard);
        });
    }

    selectUnit(unitId) {
        // Vorherige Auswahl entfernen
        document.querySelectorAll('.unit-purchase-card').forEach(card => {
            card.classList.remove('selected');
        });

        // Neue Auswahl
        const selectedCard = document.querySelector(`[data-unit-id="${unitId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
            this.selectedUnitId = unitId;
            
            // Bestätigen-Button aktivieren
            document.getElementById('confirmPurchaseBtn').disabled = false;
            
            // Ausgewählte Einheit finden
            const selectedUnit = this.availableUnits.find(u => u.id === unitId);
            if (selectedUnit) {
                document.getElementById('confirmPurchaseBtn').textContent = 
                    `${selectedUnit.name} kaufen (${selectedUnit.cost} Gold)`;
            }
        }
    }

    confirmPurchase() {
        if (!this.selectedUnitId || !this.selectedBuilding) {
            this.gameManager.showError('Keine Einheit oder Gebäude ausgewählt');
            return;
        }

        const selectedUnit = this.availableUnits.find(u => u.id === this.selectedUnitId);
        if (!selectedUnit) {
            this.gameManager.showError('Einheit nicht gefunden');
            return;
        }

        if (this.playerGold < selectedUnit.cost) {
            this.gameManager.showError('Nicht genug Gold');
            return;
        }

        console.log(`💰 Purchasing unit ${selectedUnit.name} at (${this.selectedBuilding.x}, ${this.selectedBuilding.y})`);

        // Kauf durchführen
        this.gameManager.buyUnit(
            this.selectedBuilding.x,
            this.selectedBuilding.y,
            this.selectedUnitId
        );

        // Modal schließen
        this.hide();
    }

    // Externe Aktualisierung der verfügbaren Einheiten
    updateAvailableUnits(units) {
        this.availableUnits = units;
        if (this.modal.style.display === 'flex') {
            this.renderUnits();
        }
    }

    // Externes Update des Spieler-Golds
    updateGold(newGold) {
        this.playerGold = newGold;
        if (this.modal.style.display === 'flex') {
            document.getElementById('modalPlayerGold').textContent = newGold;
            this.renderUnits(); // Neu rendern für Erschwinglichkeits-Updates
        }
    }
}

// CSS für Modal (wird dynamisch hinzugefügt)
const modalCSS = `
    .modal {
        display: none;
        position: fixed;
        z-index: 1000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        justify-content: center;
        align-items: center;
    }

    .unit-purchase-content {
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 800px;
        max-height: 90vh;
        overflow-y: auto;
    }

    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid #eee;
    }

    .close-btn {
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: #999;
    }

    .close-btn:hover {
        color: #333;
    }

    .modal-body {
        padding: 20px;
    }

    .purchase-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
    }

    .building-info h4 {
        margin: 0 0 5px 0;
        color: #2c3e50;
    }

    .building-info p {
        margin: 0;
        color: #7f8c8d;
        font-size: 14px;
    }

    .player-gold {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 18px;
        font-weight: bold;
        color: #f39c12;
    }

    .units-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 15px;
        margin-bottom: 20px;
        max-height: 400px;
        overflow-y: auto;
    }

    .unit-purchase-card {
        border: 2px solid #e9ecef;
        border-radius: 8px;
        padding: 15px;
        cursor: pointer;
        transition: all 0.3s ease;
        background: white;
    }

    .unit-purchase-card.affordable:hover {
        border-color: #3498db;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .unit-purchase-card.selected {
        border-color: #2ecc71;
        background: #d5f4e6;
    }

    .unit-purchase-card.too-expensive {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .unit-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }

    .unit-name {
        margin: 0;
        font-size: 16px;
        color: #2c3e50;
    }

    .unit-cost {
        display: flex;
        align-items: center;
        gap: 4px;
        font-weight: bold;
        color: #f39c12;
    }

    .unit-stats {
        margin-bottom: 10px;
    }

    .stat-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 5px;
    }

    .stat {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
    }

    .stat-icon {
        font-size: 14px;
    }

    .stat-value {
        font-weight: bold;
        color: #2c3e50;
    }

    .unit-description {
        font-size: 12px;
        color: #7f8c8d;
        margin-bottom: 8px;
        font-style: italic;
    }

    .level-bonus {
        background: #3498db;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        text-align: center;
        margin-top: 8px;
    }

    .not-affordable {
        background: #e74c3c;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        text-align: center;
        margin-top: 8px;
    }

    .purchase-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        padding-top: 15px;
        border-top: 1px solid #eee;
    }

    .no-units {
        text-align: center;
        color: #7f8c8d;
        font-style: italic;
        grid-column: 1 / -1;
        padding: 40px;
    }

    @media (max-width: 768px) {
        .unit-purchase-content {
            width: 95%;
            margin: 20px;
        }

        .units-grid {
            grid-template-columns: 1fr;
        }

        .purchase-info {
            flex-direction: column;
            gap: 10px;
            text-align: center;
        }

        .purchase-actions {
            flex-direction: column;
        }
    }
`;

// CSS zum Document hinzufügen
if (!document.getElementById('unit-purchase-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'unit-purchase-modal-styles';
    style.textContent = modalCSS;
    document.head.appendChild(style);
}

// Export für andere Module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnitPurchaseModal;
}