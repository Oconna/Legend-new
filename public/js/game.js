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
        this.minScale = 0.3;
        this.maxScale = 3.0;
        this.zoomStep = 0.2;
		
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.zoomCenter = { x: 0.5, y: 0.5 }; // Relative Position (0-1)
        this.activeTile = null; // Aktuell ausgewähltes/aktives Tile
		
        this.gameRenderer = null;
		
        this.initializeZoomControls();
        
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

        // Versuche Terrain-Grafik zu laden
        if (tileData.terrain_image) {
            const terrainImg = document.createElement('img');
            terrainImg.src = `/assets/images/${tileData.terrain_image}`;
            terrainImg.className = 'terrain-image';
            terrainImg.style.width = '100%';
            terrainImg.style.height = '100%';
            terrainImg.style.objectFit = 'cover';
            
            // Fallback zu Farbe bei Ladeproblemen
            terrainImg.onerror = () => {
                console.warn(`Terrain-Bild nicht gefunden: ${tileData.terrain_image}`);
                tile.style.backgroundColor = tileData.terrain_color || '#90EE90';
                terrainImg.style.display = 'none';
            };
            
            tile.appendChild(terrainImg);
        } else {
            // Fallback: Terrain Farbe verwenden
            tile.style.backgroundColor = tileData.terrain_color || '#90EE90';
        }

        // Click Handler
        tile.addEventListener('click', () => this.handleTileClick(x, y, tileData));

        // Tooltip
        tile.title = this.createTileTooltip(tileData);

        // Gebäude anzeigen
        if (tileData.building_type_id) {
            const building = document.createElement('div');
            building.className = 'tile-building';
            
            // Versuche Gebäude-Grafik zu laden
            if (tileData.building_image) {
                const buildingImg = document.createElement('img');
                buildingImg.src = `/assets/images/${tileData.building_image}`;
                buildingImg.className = 'building-image';
                buildingImg.style.width = '100%';
                buildingImg.style.height = '100%';
                buildingImg.style.objectFit = 'contain';
                
                // Fallback bei Ladeproblemen
                buildingImg.onerror = () => {
                    console.warn(`Gebäude-Bild nicht gefunden: ${tileData.building_image}`);
                    building.style.backgroundColor = tileData.building_color || '#8B4513';
                    building.textContent = tileData.building_name === 'Stadt' ? '🏘️' : '🏰';
                    buildingImg.style.display = 'none';
                };
                
                building.appendChild(buildingImg);
            } else {
                // Fallback: Farbe und Symbol
                building.style.backgroundColor = tileData.building_color || '#8B4513';
                building.textContent = tileData.building_name === 'Stadt' ? '🏘️' : '🏰';
            }
            
            // Besitzer-Rand anzeigen
            if (tileData.owner_name) {
                building.style.border = `3px solid ${tileData.owner_race_color || '#000'}`;
                building.title = `Besitzer: ${tileData.owner_name}`;
            }
            
            tile.appendChild(building);
        }

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
        console.log(`🎯 Tile clicked: (${x}, ${y})`);
        
        // Vorherige Auswahl entfernen
        const previousSelected = document.querySelector('.map-tile.selected');
        if (previousSelected) {
            previousSelected.classList.remove('selected');
        }
        
        // Neues Tile auswählen
        const newSelected = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
        if (newSelected) {
            newSelected.classList.add('selected');
        }
        
        // Aktives Tile setzen
        this.activeTile = { x, y };
        this.selectedTile = tileData;
        
        // Optional: Bei Doppelklick zum Tile zentrieren
        if (this.lastClickTime && Date.now() - this.lastClickTime < 500) {
            this.centerOnTile(x, y);
        }
        this.lastClickTime = Date.now();
        
        // Weitere Spiellogik hier...
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
	
    initializeZoomControls() {
        console.log('🎛️ Initializing zoom controls...');
        
        // Zoom-Buttons finden und Event Listener hinzufügen
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetZoomBtn = document.getElementById('resetZoomBtn');
        const mapViewport = document.getElementById('mapViewport');
        
        console.log('Zoom buttons found:', { zoomInBtn, zoomOutBtn, resetZoomBtn });
        
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔍 Zoom In clicked');
                this.zoomInAtCenter();
            });
        }
        
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔍 Zoom Out clicked');
                this.zoomOutAtCenter();
            });
        }
        
        if (resetZoomBtn) {
            resetZoomBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔍 Zoom Reset clicked');
                this.resetZoom();
            });
        }
        
        // Mausrad-Zoom mit variabler Position
        if (mapViewport) {
            // Mausbewegung verfolgen
            mapViewport.addEventListener('mousemove', (e) => {
                const rect = mapViewport.getBoundingClientRect();
                this.lastMouseX = e.clientX - rect.left;
                this.lastMouseY = e.clientY - rect.top;
                
                // Relative Position berechnen (0-1)
                this.zoomCenter.x = this.lastMouseX / rect.width;
                this.zoomCenter.y = this.lastMouseY / rect.height;
            });

            mapViewport.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (e.deltaY > 0) {
                    this.zoomOutAtMouse(e);
                } else {
                    this.zoomInAtMouse(e);
                }
            }, { passive: false });
        }
        
        // Tastatur-Shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            
            switch (e.key) {
                case '+':
                case '=':
                    e.preventDefault();
                    this.zoomInAtCenter();
                    break;
                case '-':
                    e.preventDefault();
                    this.zoomOutAtCenter();
                    break;
                case '0':
                    e.preventDefault();
                    this.resetZoom();
                    break;
            }
        });
        
        console.log('✅ Zoom controls initialized successfully');
    }
	
    zoomInAtMouse(event) {
        console.log('🔍 Zooming in at mouse position...');
        const rect = event.target.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        this.zoomAtPosition(mouseX, mouseY, true);
    }

    zoomOutAtMouse(event) {
        console.log('🔍 Zooming out at mouse position...');
        const rect = event.target.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        this.zoomAtPosition(mouseX, mouseY, false);
    }

    // Zoom zum Zentrum (für Buttons)
    zoomInAtCenter() {
        console.log('🔍 Zooming in at center...');
        const mapViewport = document.getElementById('mapViewport');
        if (mapViewport) {
            const centerX = mapViewport.clientWidth / 2;
            const centerY = mapViewport.clientHeight / 2;
            this.zoomAtPosition(centerX, centerY, true);
        }
    }

    zoomOutAtCenter() {
        console.log('🔍 Zooming out at center...');
        const mapViewport = document.getElementById('mapViewport');
        if (mapViewport) {
            const centerX = mapViewport.clientWidth / 2;
            const centerY = mapViewport.clientHeight / 2;
            this.zoomAtPosition(centerX, centerY, false);
        }
    }

    // Zoom zum aktiven Tile
zoomToActiveTile() {
    if (this.activeTile) {
        console.log('🔍 Zooming to active tile:', this.activeTile);
        
        // Erst zentrieren, dann optional zoomen
        this.centerOnTile(this.activeTile.x, this.activeTile.y);
        
        // Optional: Zoom-Level anpassen falls zu weit raus
        if (this.mapScale < 1.0) {
            setTimeout(() => {
                this.mapScale = 1.0;
                this.applyMapZoom();
                this.updateZoomDisplay();
                // Nach Zoom nochmals zentrieren
                this.centerOnTile(this.activeTile.x, this.activeTile.y);
            }, 300); // Warten bis Smooth-Scroll fertig ist
        }
    } else {
        console.warn('Kein aktives Tile zum Zentrieren vorhanden');
    }
}

    // Hauptzoom-Funktion mit variabler Position
    zoomAtPosition(mouseX, mouseY, zoomIn) {
        const mapViewport = document.getElementById('mapViewport');
        const mapGrid = document.getElementById('mapGrid');
        
        if (!mapViewport || !mapGrid) return;

        const oldScale = this.mapScale;
        const newScale = zoomIn 
            ? Math.min(this.maxScale, this.mapScale + this.zoomStep)
            : Math.max(this.minScale, this.mapScale - this.zoomStep);

        if (newScale === oldScale) return; // Keine Änderung

        // Aktuelle Scroll-Position speichern
        const oldScrollLeft = mapViewport.scrollLeft;
        const oldScrollTop = mapViewport.scrollTop;

        // Viewport-Dimensionen
        const viewportRect = mapViewport.getBoundingClientRect();
        
        // Mausposition relativ zum Viewport
        const relativeMouseX = mouseX / viewportRect.width;
        const relativeMouseY = mouseY / viewportRect.height;

        // Zoom anwenden
        this.mapScale = newScale;
        mapGrid.style.transform = `scale(${this.mapScale})`;
        mapGrid.style.transformOrigin = 'top left';

        // Nach dem Scale-Update neue Dimensionen berechnen
        setTimeout(() => {
            const gridRect = mapGrid.getBoundingClientRect();
            
            // Neue Scroll-Position berechnen um den Zoom-Punkt zu erhalten
            const scaleFactor = newScale / oldScale;
            
            const newScrollLeft = (oldScrollLeft + mouseX) * scaleFactor - mouseX;
            const newScrollTop = (oldScrollTop + mouseY) * scaleFactor - mouseY;

            mapViewport.scrollLeft = Math.max(0, newScrollLeft);
            mapViewport.scrollTop = Math.max(0, newScrollTop);

            this.updateZoomDisplay();
            console.log('✅ Zoomed to:', Math.round(this.mapScale * 100) + '%');
        }, 0);
    }

    // Auf ein bestimmtes Tile zentrieren
centerOnTile(tileX, tileY) {
    console.log(`🎯 Centering on tile (${tileX}, ${tileY})`);
    
    const mapViewport = document.getElementById('mapViewport');
    const mapGrid = document.getElementById('mapGrid');
    
    if (!mapViewport || !mapGrid) {
        console.error('MapViewport or MapGrid not found');
        return;
    }

    // Tile-Größe (48px aus CSS)
    const baseTileSize = 48;
    
    // Berechne die Position des Tile-Zentrums in der nicht-skalierten Karte
    const tileCenterX = (tileX + 0.5) * baseTileSize;
    const tileCenterY = (tileY + 0.5) * baseTileSize;
    
    // Berechne die Position in der skalierten Karte
    const scaledTileCenterX = tileCenterX * this.mapScale;
    const scaledTileCenterY = tileCenterY * this.mapScale;
    
    // Viewport-Dimensionen
    const viewportCenterX = mapViewport.clientWidth / 2;
    const viewportCenterY = mapViewport.clientHeight / 2;
    
    // Berechne die neue Scroll-Position um das Tile zu zentrieren
    const targetScrollLeft = scaledTileCenterX - viewportCenterX;
    const targetScrollTop = scaledTileCenterY - viewportCenterY;
    
    // Grenzen der scrollbaren Bereiche berechnen
    const maxScrollLeft = Math.max(0, mapGrid.scrollWidth - mapViewport.clientWidth);
    const maxScrollTop = Math.max(0, mapGrid.scrollHeight - mapViewport.clientHeight);
    
    // Scroll-Position auf gültige Bereiche beschränken
    const finalScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));
    const finalScrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));
    
    console.log('Center calculations:', {
        tileCoords: { x: tileX, y: tileY },
        baseTileSize,
        mapScale: this.mapScale,
        tileCenterOriginal: { x: tileCenterX, y: tileCenterY },
        tileCenterScaled: { x: scaledTileCenterX, y: scaledTileCenterY },
        viewportCenter: { x: viewportCenterX, y: viewportCenterY },
        targetScroll: { left: targetScrollLeft, top: targetScrollTop },
        finalScroll: { left: finalScrollLeft, top: finalScrollTop }
    });
    
    // Smooth-Scroll anwenden
    mapViewport.scrollTo({
        left: finalScrollLeft,
        top: finalScrollTop,
        behavior: 'smooth'
    });
    
    // Aktives Tile setzen
    this.activeTile = { x: tileX, y: tileY };
    
    // Optional: Visuelles Feedback
    this.highlightTile(tileX, tileY);
}

highlightTile(tileX, tileY) {
    // Vorherige Hervorhebung entfernen
    const previousHighlighted = document.querySelector('.map-tile.highlighted');
    if (previousHighlighted) {
        previousHighlighted.classList.remove('highlighted');
    }
    
    // Neues Tile hervorheben
    const targetTile = document.querySelector(`[data-x="${tileX}"][data-y="${tileY}"]`);
    if (targetTile) {
        targetTile.classList.add('highlighted');
        
        // Auto-Remove nach 3 Sekunden
        setTimeout(() => {
            targetTile.classList.remove('highlighted');
        }, 3000);
    }
}
    
    zoomIn() {
        console.log('🔍 Zooming in... Current scale:', this.mapScale);
        const newScale = Math.min(this.maxScale, this.mapScale + this.zoomStep);
        if (newScale !== this.mapScale) {
            this.mapScale = newScale;
            this.applyMapZoom();
            this.updateZoomDisplay();
            console.log('✅ Zoomed to:', Math.round(this.mapScale * 100) + '%');
        }
    }
    
    zoomOut() {
        console.log('🔍 Zooming out... Current scale:', this.mapScale);
        const newScale = Math.max(this.minScale, this.mapScale - this.zoomStep);
        if (newScale !== this.mapScale) {
            this.mapScale = newScale;
            this.applyMapZoom();
            this.updateZoomDisplay();
            console.log('✅ Zoomed to:', Math.round(this.mapScale * 100) + '%');
        }
    }
    
    resetZoom() {
        console.log('🔍 Resetting zoom...');
        this.mapScale = 1.0;
        this.applyMapZoom();
        this.updateZoomDisplay();
        
        // Optional: Karte zentrieren nach Reset
        this.centerMap();
        
        console.log('✅ Zoom reset to 100%');
    }
    
    applyMapZoom() {
        const mapGrid = document.getElementById('mapGrid');
        if (mapGrid) {
            mapGrid.style.transform = `scale(${this.mapScale})`;
            mapGrid.style.transformOrigin = 'top left';
            mapGrid.style.transition = 'transform 0.2s ease';
        }
    }
    
    updateZoomDisplay() {
        // Erstelle oder aktualisiere Zoom-Display
        let zoomInfo = document.getElementById('zoomInfo');
        if (!zoomInfo) {
            zoomInfo = document.createElement('div');
            zoomInfo.id = 'zoomInfo';
            zoomInfo.style.cssText = `
                position: absolute;
                bottom: 10px;
                left: 10px;
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                z-index: 90;
                pointer-events: none;
                transition: opacity 0.3s ease;
            `;
            document.querySelector('.map-container').appendChild(zoomInfo);
        }
        
        const zoomPercent = Math.round(this.mapScale * 100);
        zoomInfo.textContent = `Zoom: ${zoomPercent}%`;
        zoomInfo.style.opacity = '1';
        
        // Auto-fade nach 2 Sekunden
        clearTimeout(this.zoomDisplayTimeout);
        this.zoomDisplayTimeout = setTimeout(() => {
            zoomInfo.style.opacity = '0.3';
        }, 2000);
    }
    
    // GameRenderer setzen falls vorhanden
    setGameRenderer(renderer) {
        this.gameRenderer = renderer;
        console.log('GameRenderer set for zoom controls');
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
    if (window.game && window.game.zoomIn) {
        window.game.zoomIn();
    }
}

function zoomOut() {
    if (window.game && window.game.zoomOut) {
        window.game.zoomOut();
    }
}

function resetZoom() {
    if (window.game && window.game.resetZoom) {
        window.game.resetZoom();
    }
}

// Initialize Game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.game = new StrategyGame();
});