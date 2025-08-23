// public/js/game.js
// Client-seitiger Code für das Strategiespiel

class StrategyGame {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.playerName = null;
        this.currentPlayerId = null;
        this.gameState = null;
        this.mapData = null;
        this.selectedTile = null;
        this.mapScale = 1.0;
        this.minScale = 0.5;
        this.maxScale = 2.0;
        
        this.init();
    }

    init() {
        console.log('🎮 Initializing Strategy Game Client');
        
        // Hole URL-Parameter
        this.parseUrlParameters();
        
        if (!this.gameId || !this.playerName) {
            this.showError('Ungültige Spielparameter. Zurück zur Lobby...');
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }

        // Socket-Verbindung initialisieren
        this.initSocket();
        
        // Event Listeners einrichten
        this.setupEventListeners();
        
        // UI initialisieren
        this.initUI();
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
            this.showError('Verbindung verloren. Versuche neu zu verbinden...');
        });

        // Game State Events
        this.socket.on('game_state', (data) => {
            console.log('📥 Game state received:', data);
            this.handleGameState(data);
        });

        this.socket.on('map_generated', (data) => {
            console.log('📥 Map generated:', data);
            this.handleMapGenerated(data);
        });

        this.socket.on('map_data', (data) => {
            console.log('📥 Map data received:', data);
            this.handleMapData(data);
        });

        this.socket.on('game_started', (data) => {
            console.log('📥 Game started:', data);
            this.handleGameStarted(data);
        });

        // Error Handling
        this.socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
            this.showError(error);
        });

        this.socket.on('notification', (data) => {
            this.showNotification(data.message, data.type || 'info');
        });
    }

    setupEventListeners() {
        // End Turn Button
        const endTurnBtn = document.getElementById('endTurnBtn');
        if (endTurnBtn) {
            endTurnBtn.addEventListener('click', () => this.endTurn());
        }

        // Center Map Button
        const centerMapBtn = document.getElementById('centerMapBtn');
        if (centerMapBtn) {
            centerMapBtn.addEventListener('click', () => this.centerMap());
        }

        // Leave Game Button
        const leaveGameBtn = document.getElementById('leaveGameBtn');
        if (leaveGameBtn) {
            leaveGameBtn.addEventListener('click', () => this.leaveGame());
        }

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.deselectTile();
            } else if (e.key === 'Enter' && this.isMyTurn()) {
                this.endTurn();
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.adjustMapSize();
        });
    }

    initUI() {
        // Zeige Loading Screen
        this.showLoadingScreen(true);
        
        // Update Game Info
        this.updateGameInfo();
    }

    joinGameRoom() {
        console.log('🚪 Joining game room...');
        this.socket.emit('join_db_game_room', {
            gameId: this.gameId,
            playerName: this.playerName
        });

        // Fordere Spielzustand an
        this.socket.emit('get_game_state', {
            gameId: this.gameId
        });
    }

    handleGameState(data) {
        if (!data.success) {
            this.showError(data.message || 'Fehler beim Laden des Spielzustands');
            return;
        }

        this.gameState = data.gameState;
        console.log('Game State loaded:', this.gameState);

        // Finde aktuellen Spieler
        this.currentPlayerId = this.gameState.players.find(p => p.player_name === this.playerName)?.id;

        // Update UI
        this.updateUI();

        // Lade Kartendaten
        this.loadMapData();
    }

    handleMapGenerated(data) {
        console.log('Map generated successfully:', data);
        this.showNotification('Karte wurde generiert! Lade Spielzustand...', 'success');
        
        // Fordere aktuellen Spielzustand an
        setTimeout(() => {
            this.socket.emit('get_game_state', {
                gameId: this.gameId
            });
        }, 1000);
    }

    handleMapData(data) {
        if (!data.success) {
            this.showError('Fehler beim Laden der Kartendaten');
            return;
        }

        this.mapData = data.mapData;
        console.log('Map data loaded:', this.mapData.length, 'tiles');

        // Erstelle Karte
        this.renderMap();
        
        // Verstecke Loading Screen
        this.showLoadingScreen(false);
        
        this.showNotification('Spiel geladen! Viel Erfolg!', 'success');
    }

    handleGameStarted(data) {
        console.log('Game started:', data);
        this.showNotification('Das Spiel hat begonnen!', 'success');
    }

    loadMapData() {
        console.log('Loading map data...');
        this.socket.emit('get_map_data', {
            gameId: this.gameId
        });
    }

    renderMap() {
        if (!this.mapData || this.mapData.length === 0) {
            console.error('No map data to render');
            return;
        }

        console.log('🗺️ Rendering map...');

        // Bestimme Kartengröße
        const maxX = Math.max(...this.mapData.map(tile => tile.x_coordinate));
        const maxY = Math.max(...this.mapData.map(tile => tile.y_coordinate));
        const mapSize = Math.max(maxX, maxY) + 1;

        // Update Map Size Display
        document.getElementById('mapSize').textContent = `${mapSize}x${mapSize}`;

        // Erstelle Karten-Grid
        const mapGrid = document.getElementById('mapGrid');
        mapGrid.style.gridTemplateColumns = `repeat(${mapSize}, 48px)`;
        mapGrid.style.gridTemplateRows = `repeat(${mapSize}, 48px)`;
        mapGrid.innerHTML = '';

        // Erstelle Tiles
        for (let x = 0; x < mapSize; x++) {
            for (let y = 0; y < mapSize; y++) {
                const tileData = this.mapData.find(tile => 
                    tile.x_coordinate === x && tile.y_coordinate === y
                );

                if (tileData) {
                    const tileElement = this.createTileElement(tileData, x, y);
                    mapGrid.appendChild(tileElement);
                }
            }
        }

        console.log(`✅ Map rendered: ${mapSize}x${mapSize}`);
        this.adjustMapSize();
    }

    createTileElement(tileData, x, y) {
        const tile = document.createElement('div');
        tile.className = 'map-tile';
        tile.dataset.x = x;
        tile.dataset.y = y;
        tile.dataset.tileId = tileData.id;

        // Terrain Farbe
        tile.style.backgroundColor = tileData.terrain_color || '#90EE90';

        // Click Handler
        tile.addEventListener('click', () => this.handleTileClick(x, y, tileData));

        // Tooltip
        tile.title = this.createTileTooltip(tileData);

        // Gebäude anzeigen
        if (tileData.building_type_id) {
            const building = document.createElement('div');
            building.className = 'tile-building';
            building.style.backgroundColor = tileData.building_color || '#8B4513';
            
            // Gebäude-Symbol
            building.textContent = tileData.building_name === 'Stadt' ? '🏘️' : '🏰';
            
            // Besitzer-Indikator
            if (tileData.owner_player_id) {
                building.style.borderColor = this.getPlayerColor(tileData.owner_player_id);
            }

            tile.appendChild(building);
        }

        // TODO: Einheiten anzeigen (wird später implementiert)

        return tile;
    }

    createTileTooltip(tileData) {
        let tooltip = `${tileData.terrain_name} (${tileData.x_coordinate}, ${tileData.y_coordinate})`;
        
        if (tileData.building_name) {
            tooltip += `\n${tileData.building_name}`;
            if (tileData.owner_name) {
                tooltip += ` (${tileData.owner_name})`;
            }
            if (tileData.gold_income) {
                tooltip += ` - ${tileData.gold_income} Gold/Zug`;
            }
        }

        tooltip += `\nBewegungskosten: ${tileData.movement_cost}`;

        return tooltip;
    }

    handleTileClick(x, y, tileData) {
        console.log('Tile clicked:', x, y, tileData);

        // Entferne vorherige Selektion
        this.deselectTile();

        // Selektiere neues Tile
        this.selectedTile = { x, y, data: tileData };
        
        // Visuelles Feedback
        const tileElement = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
        if (tileElement) {
            tileElement.style.border = '2px solid #FFD700';
            tileElement.style.zIndex = '20';
        }

        console.log('Selected tile:', this.selectedTile);
    }

    deselectTile() {
        if (this.selectedTile) {
            const tileElement = document.querySelector(
                `[data-x="${this.selectedTile.x}"][data-y="${this.selectedTile.y}"]`
            );
            if (tileElement) {
                tileElement.style.border = '1px solid rgba(255, 255, 255, 0.3)';
                tileElement.style.zIndex = 'auto';
            }
            this.selectedTile = null;
        }
    }

    updateUI() {
        if (!this.gameState) return;

        // Update Game Info
        document.getElementById('gameName').textContent = this.gameState.game.name;
        document.getElementById('turnNumber').textContent = this.gameState.game.turn_number || 1;

        // Update Current Player
        const currentPlayer = this.gameState.players.find(
            p => p.id === this.gameState.game.current_turn_player_id
        );
        document.getElementById('currentPlayer').textContent = 
            currentPlayer ? currentPlayer.player_name : '-';

        // Update Players List
        this.updatePlayersList();

        // Update My Stats
        this.updatePlayerStats();

        // Update Buttons
        this.updateButtons();
    }

    updatePlayersList() {
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = '';

        this.gameState.players.forEach(player => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            if (player.id === this.gameState.game.current_turn_player_id) {
                playerItem.classList.add('current-turn');
            }

            playerItem.innerHTML = `
                <div class="player-color" style="background-color: ${player.race_color || '#666'}"></div>
                <div>
                    <div style="font-weight: bold;">${player.player_name}</div>
                    <div style="font-size: 12px; opacity: 0.8;">${player.race_name || 'Keine Rasse'}</div>
                </div>
            `;

            playersList.appendChild(playerItem);
        });
    }

    updatePlayerStats() {
        const myPlayer = this.gameState.players.find(p => p.id === this.currentPlayerId);
        
        if (myPlayer) {
            document.getElementById('playerGold').textContent = myPlayer.gold || 0;
            
            // TODO: Berechne Städte, Burgen und Einheiten aus mapData
            // Diese Werte werden später aus den tatsächlichen Kartendaten berechnet
            document.getElementById('playerCities').textContent = 0;
            document.getElementById('playerCastles').textContent = 0;
            document.getElementById('playerUnits').textContent = 0;
        }
    }

    updateButtons() {
        const endTurnBtn = document.getElementById('endTurnBtn');
        
        if (this.isMyTurn()) {
            endTurnBtn.disabled = false;
            endTurnBtn.textContent = 'Zug beenden';
        } else {
            endTurnBtn.disabled = true;
            const currentPlayer = this.gameState.players.find(
                p => p.id === this.gameState.game.current_turn_player_id
            );
            endTurnBtn.textContent = `${currentPlayer?.player_name || 'Spieler'} ist am Zug`;
        }
    }

    isMyTurn() {
        return this.gameState && 
               this.gameState.game.current_turn_player_id === this.currentPlayerId;
    }

    getPlayerColor(playerId) {
        const player = this.gameState?.players.find(p => p.id === playerId);
        return player?.race_color || '#666';
    }

    // Game Actions
    endTurn() {
        if (!this.isMyTurn()) {
            this.showNotification('Du bist nicht am Zug!', 'error');
            return;
        }

        console.log('Ending turn...');
        this.socket.emit('end_turn', {
            gameId: this.gameId,
            playerId: this.currentPlayerId
        });

        this.showNotification('Zug wird beendet...', 'info');
    }

    leaveGame() {
        if (confirm('Möchtest du das Spiel wirklich verlassen?')) {
            console.log('Leaving game...');
            window.location.href = '/';
        }
    }

    // Map Controls
    centerMap() {
        const mapViewport = document.getElementById('mapViewport');
        const mapGrid = document.getElementById('mapGrid');
        
        if (mapViewport && mapGrid) {
            const viewportRect = mapViewport.getBoundingClientRect();
            const gridRect = mapGrid.getBoundingClientRect();
            
            mapViewport.scrollLeft = (gridRect.width - viewportRect.width) / 2;
            mapViewport.scrollTop = (gridRect.height - viewportRect.height) / 2;
        }
    }

    adjustMapSize() {
        // Responsive map sizing wird hier implementiert falls nötig
    }

    // UI Helper Functions
    updateGameInfo() {
        // Initial game info update
        if (this.gameId) {
            document.getElementById('gameName').textContent = `Spiel ${this.gameId}`;
        }
    }

    showLoadingScreen(show) {
        const loadingScreen = document.getElementById('loadingScreen');
        const gameContainer = document.getElementById('gameContainer');
        
        if (show) {
            loadingScreen.style.display = 'flex';
            gameContainer.style.display = 'none';
        } else {
            loadingScreen.style.display = 'none';
            gameContainer.style.display = 'flex';
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, 4000);

        console.log(`Notification (${type}):`, message);
    }

    showError(message) {
        this.showNotification(message, 'error');
        console.error('Game Error:', message);
    }
}

// Zoom Functions (Global)
function zoomIn() {
    if (window.game) {
        window.game.mapScale = Math.min(window.game.maxScale, window.game.mapScale + 0.1);
        applyMapZoom();
    }
}

function zoomOut() {
    if (window.game) {
        window.game.mapScale = Math.max(window.game.minScale, window.game.mapScale - 0.1);
        applyMapZoom();
    }
}

function resetZoom() {
    if (window.game) {
        window.game.mapScale = 1.0;
        applyMapZoom();
    }
}

function applyMapZoom() {
    const mapGrid = document.getElementById('mapGrid');
    if (mapGrid) {
        mapGrid.style.transform = `scale(${window.game.mapScale})`;
        mapGrid.style.transformOrigin = 'top left';
    }
}

// Initialize Game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.game = new StrategyGame();
});