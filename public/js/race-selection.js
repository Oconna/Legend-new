// Race Selection Client - public/js/race-selection.js (KORRIGIERT)
class RaceSelectionClient {
    constructor() {
        this.socket = null;
        this.playerName = null;
        this.gameId = null;
        this.gameDbId = null;
        this.availableRaces = [];
        this.selectedRace = null;
        this.isConfirmed = false;
        this.allSelections = [];
        this.totalPlayers = 0;
        this.readyPlayers = 0;
        
        this.init();
    }

    init() {
        console.log('🎮 Initializing Race Selection Client...');
        
        // URL-Parameter auslesen
        this.parseURLParams();
        
        // Socket-Verbindung herstellen
        this.initSocket();
        
        // Event-Listener einrichten
        this.setupEventListeners();
        
        // UI initialisieren
        this.initUI();
        
        // Verfügbare Rassen laden
        this.loadAvailableRaces();
    }

    parseURLParams() {
        const urlParams = new URLSearchParams(window.location.search);
        this.playerName = urlParams.get('player') || 'Unbekannt';
        this.gameDbId = urlParams.get('gameId');
        
        console.log('📋 URL Parameters:', { 
            playerName: this.playerName, 
            gameDbId: this.gameDbId 
        });
        
        if (!this.gameDbId) {
            console.error('❌ No game ID in URL');
            this.showError('Keine Spiel-ID gefunden. Zurück zur Lobby.');
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }
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

        // Race Selection Events
        this.socket.on('races_loaded', (data) => {
            console.log('📥 Races loaded:', data);
            this.handleRacesLoaded(data);
        });

        this.socket.on('race_selected', (data) => {
            console.log('📥 Race selected response:', data);
            this.handleRaceSelected(data);
        });

        this.socket.on('race_confirmed', (data) => {
            console.log('📥 Race confirmed response:', data);
            this.handleRaceConfirmed(data);
        });

        this.socket.on('race_deselected', (data) => {
            console.log('📥 Race deselected response:', data);
            this.handleRaceDeselected(data);
        });

        this.socket.on('race_selection_sync', (data) => {
            console.log('📥 Race selection sync:', data);
            this.handleRaceSelectionSync(data);
        });

        this.socket.on('race_details_loaded', (data) => {
            console.log('📥 Race details loaded:', data);
            this.handleRaceDetailsLoaded(data);
        });

        this.socket.on('game_start_ready', (data) => {
            console.log('📥 Game start ready:', data);
            this.handleGameStartReady(data);
        });

        // Chat Events
        this.socket.on('chat_message', (data) => {
            this.handleChatMessage(data);
        });

        this.socket.on('chat_history', (data) => {
            this.handleChatHistory(data);
        });

        // Error Handling
        this.socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
            this.showError(error);
        });
		
		// Socket Event für Spielweiterleitung
        this.socket.on('redirect_to_game', (data) => {
        console.log('📥 Redirect to game:', data);
        this.handleRedirectToGame(data);
        });

        this.socket.on('map_generated', (data) => {
        console.log('📥 Map generated:', data);
        this.handleMapGenerated(data);
        });
    
        // Ergänze diesen Event-Handler für Errors:
        this.socket.on('map_generation_error', (data) => {
        console.error('❌ Map generation error:', data);
        this.showError('Fehler bei der Kartengenerierung: ' + data.message);
        });
    }

    joinGameRoom() {
        console.log('🚪 Joining game room for race selection...');
        this.socket.emit('join_race_selection', {
            gameId: this.gameDbId,
            playerName: this.playerName
        });
    }

    setupEventListeners() {
        // Confirm Button
        const confirmBtn = document.getElementById('btn-confirm"');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.confirmRaceSelection());
        }

        // Change Button
        const changeBtn = document.getElementById('btn-change');
        if (changeBtn) {
            changeBtn.addEventListener('click', () => this.changeRaceSelection());
        }

        // Back Button
        const backBtn = document.getElementById('btn-back');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.goBackToLobby());
        }

        // Race Details Modal
        const modal = document.getElementById('raceDetailsModal');
        const closeBtn = modal?.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeRaceDetailsModal());
        }

        // Close modal on outside click
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeRaceDetailsModal();
                }
            });
        }

        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeRaceDetailsModal();
            }
        });
    }

    initUI() {
        // Player name anzeigen
        const playerNameEl = document.getElementById('playerName');
        if (playerNameEl) {
            playerNameEl.textContent = `Spieler: ${this.playerName}`;
        }

        // Game info anzeigen
        const gameInfoEl = document.getElementById('gameInfo');
        if (gameInfoEl) {
            gameInfoEl.textContent = `Spiel-ID: ${this.gameDbId}`;
        }

        this.updateSelectionStatus('Lädt verfügbare Rassen...');
        console.log('🎨 UI initialized');
    }

    loadAvailableRaces() {
        console.log('📤 Requesting available races...');
        this.socket.emit('get_available_races', {
            gameId: this.gameDbId,
            playerName: this.playerName
        });
    }

    handleRacesLoaded(data) {
        if (!data.success) {
            this.showError('Fehler beim Laden der Rassen: ' + data.message);
            return;
        }

        this.availableRaces = data.races;
        this.totalPlayers = data.totalPlayers || 0;
        
        console.log(`✅ Loaded ${this.availableRaces.length} races for ${this.totalPlayers} players`);
        
        this.renderRaces();
        this.updatePlayerCount();
        this.updateSelectionStatus('Wähle eine Rasse aus');
    }

    renderRaces() {
        const racesGrid = document.getElementById('racesGrid');
        if (!racesGrid) return;

        racesGrid.innerHTML = '';

        this.availableRaces.forEach(race => {
            const raceCard = this.createRaceCard(race);
            racesGrid.appendChild(raceCard);
        });

        console.log(`🎨 Rendered ${this.availableRaces.length} race cards`);
    }

    createRaceCard(race) {
        const card = document.createElement('div');
        card.className = 'race-card';
        card.dataset.raceId = race.id;
        
        card.innerHTML = `
            <div class="race-header" style="background-color: ${race.color_hex}">
                <h3>${race.name}</h3>
                <span class="unit-count">${race.unit_count} Einheiten</span>
            </div>
            <div class="race-body">
                <p class="race-description">${race.description || 'Keine Beschreibung verfügbar'}</p>
                <div class="race-actions">
                    <button class="btn btn-details" onclick="raceClient.showRaceDetails(${race.id})">
                        Details
                    </button>
                    <button class="btn btn-select" onclick="raceClient.selectRace(${race.id})">
                        Auswählen
                    </button>
                </div>
            </div>
        `;

        return card;
    }

    selectRace(raceId) {
        if (this.isConfirmed) {
            this.showError('Du hast bereits eine Rasse bestätigt. Klicke auf "Rasse ändern" um eine neue zu wählen.');
            return;
        }

        const race = this.availableRaces.find(r => r.id === raceId);
        if (!race) {
            this.showError('Rasse nicht gefunden');
            return;
        }

        console.log(`📤 Selecting race: ${race.name} (ID: ${raceId})`);
        
        this.socket.emit('select_race', {
            gameId: this.gameDbId,
            playerName: this.playerName,
            raceId: raceId
        });

        this.updateSelectionStatus('Auswahl wird verarbeitet...');
        this.setUILoading(true);
    }

    handleRaceSelected(data) {
        this.setUILoading(false);
        
        if (!data.success) {
            this.showError('Fehler bei der Rassenauswahl: ' + data.message);
            return;
        }

        const race = this.availableRaces.find(r => r.id === data.raceId);
        this.selectedRace = race;
		this.selectedRaceId = race.id; 
        
        console.log(`✅ Race selected: ${race.name}`);
        
        this.updateRaceCardStyles();
        this.updateSelectionStatus(`Rasse gewählt: ${race.name}`);
        this.enableConfirmButton();
    }
	
handleMapGenerated(data) {
    if (data.success) {
        console.log('🗺️ Map successfully generated!', data);
        
        // Entferne Warteanzeige
        const waitingDiv = document.getElementById('mapGenerationWaiting');
        if (waitingDiv) waitingDiv.remove();
        
        // Update Status
        this.updateSelectionStatus('Karte erfolgreich generiert! Spiel startet...');
        this.showSuccess('Karte generiert! Weiterleitung zum Spiel...');
        this.showProgress('Lade Spiel...', 100);
        
        // Weiterleitung zum Hauptspiel nach kurzer Verzögerung
        setTimeout(() => {
            const gameUrl = `/game.html?gameId=${data.gameId}&playerName=${encodeURIComponent(this.playerName)}`;
            console.log('Redirecting to:', gameUrl);
            window.location.href = gameUrl;
        }, 2000);
    } else {
        this.showError('Fehler bei der Kartengenerierung: ' + data.message);
        
        // Bei Fehler: Zeige Rassen-UI wieder an
        this.showRaceSelection();
    }
}

showRaceSelection() {
    const racesGrid = document.getElementById('racesGrid');
    const confirmBtn = document.getElementById('confirmBtn');
    
    if (racesGrid) racesGrid.style.display = 'grid';
    if (confirmBtn && this.selectedRace && !this.isConfirmed) {
        confirmBtn.style.display = 'block';
    }
}

handleRedirectToGame(data) {
    console.log('Redirecting to game:', data);
    
    this.showSuccess('Karte generiert! Weiterleitung zum Spiel...');
    this.showProgress('Lade Spiel...', 100);
    
    // Kurze Verzögerung für bessere UX
    setTimeout(() => {
        const gameUrl = `/game.html?gameId=${data.gameId}&playerName=${encodeURIComponent(this.playerName)}`;
        console.log('Redirecting to:', gameUrl);
        window.location.href = gameUrl;
    }, 2000);
}

confirmRaceSelection() {
    if (!this.selectedRaceId) {
        this.showError('Bitte wähle zuerst eine Rasse aus');
        return;
    }

    if (this.raceConfirmed) {
        this.showError('Du hast bereits eine Rasse bestätigt');
        return;
    }

    console.log('🎯 Confirming race selection:', this.selectedRaceId);

    // UI Update: Zeige Bestätigungsstatus
    this.showProgress('Rasse wird bestätigt...', 60);
    
    // Sende Bestätigung an Server
    this.socket.emit('confirm_race', {
        gameId: this.gameDbId, // Verwende gameDbId statt gameId
        playerName: this.playerName,
        raceId: this.selectedRace?.id
    });

    // Disable Button während der Verarbeitung
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Wird bestätigt...';
    }
}

handleRaceConfirmed(data) {
    console.log('📥 Race confirmed response:', data);
    
    if (data.success) {
        this.raceConfirmed = true;
        this.showSuccess(`Rasse ${this.selectedRace?.name || 'erfolgreich'} bestätigt!`);
        
        // UI Updates
        const confirmBtn = document.getElementById('confirmBtn');
        if (confirmBtn) {
            confirmBtn.textContent = 'Rasse bestätigt ✅';
            confirmBtn.classList.add('confirmed');
        }
        
        // Verstecke Progress Bar
        const progressContainer = document.getElementById('progressContainer');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        
    } else {
        this.showError('Fehler beim Bestätigen: ' + (data.message || 'Unbekannter Fehler'));
        
        // Button wieder aktivieren
        const confirmBtn = document.getElementById('confirmBtn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Rasse bestätigen';
        }
    }
}

    changeRaceSelection() {
        if (!this.isConfirmed) return;

        console.log('📤 Requesting race change...');
        
        this.socket.emit('deselect_race', {
            gameId: this.gameDbId,
            playerName: this.playerName
        });

        this.updateSelectionStatus('Rasse wird zurückgesetzt...');
        this.setUILoading(true);
    }

    handleRaceDeselected(data) {
        this.setUILoading(false);
        
        if (!data.success) {
            this.showError('Fehler beim Zurücksetzen: ' + data.message);
            return;
        }

        this.selectedRace = null;
        this.isConfirmed = false;
        
        console.log('✅ Race deselected');
        
        this.updateRaceCardStyles();
        this.updateSelectionStatus('Wähle eine neue Rasse aus');
        this.hideChangeButton();
        this.hideWaitingArea();
        this.disableConfirmButton();
    }

    handleRaceSelectionSync(data) {
        this.allSelections = data.selections;
        this.readyPlayers = data.selections.filter(s => s.race_confirmed).length;
        
        console.log(`📊 Race sync: ${this.readyPlayers}/${this.totalPlayers} players ready`);
        
        this.updatePlayerCount();
        
        // Prüfe ob alle Spieler bereit sind
        if (this.readyPlayers === this.totalPlayers && this.totalPlayers > 0) {
            console.log('🎉 All players ready - game should start soon');
            this.updateSelectionStatus('Alle Spieler bereit! Spiel startet...');
        }
    }

handleGameStartReady(data) {
    console.log('🚀 Game is starting automatically...', data);
    
    // Update UI für automatischen Start
    this.updateSelectionStatus('Alle Spieler bereit! Karte wird generiert...');
    this.showProgress('Kartengenerierung läuft...', 75);
    
    // Zeige Info-Message
    this.showSuccess(data.message || 'Kartengenerierung startet automatisch!');
    
    // Verstecke alle Rassen-UI Elemente
    this.hideRaceSelection();
    
    // Zeige Warteanzeige
    this.showWaitingForMapGeneration();
}

// Neue UI-Hilfsmethoden:
hideRaceSelection() {
    const racesGrid = document.getElementById('racesGrid');
    const confirmBtn = document.getElementById('confirmBtn');
    const changeBtn = document.getElementById('changeBtn');
    
    if (racesGrid) racesGrid.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = 'none';
    if (changeBtn) changeBtn.style.display = 'none';
}

showWaitingForMapGeneration() {
    const container = document.querySelector('.container');
    if (!container) return;
    
    // Erstelle Wartebereich für Kartengenerierung
    const waitingDiv = document.createElement('div');
    waitingDiv.id = 'mapGenerationWaiting';
    waitingDiv.className = 'waiting-for-map';
    waitingDiv.innerHTML = `
        <div class="map-generation-info">
            <h3>🗺️ Karte wird generiert...</h3>
            <div class="loading-spinner"></div>
            <p>Alle Spieler haben ihre Rassen gewählt.</p>
            <p>Die Karte wird automatisch erstellt.</p>
            <div class="progress-dots">
                <span class="dot">●</span>
                <span class="dot">●</span>
                <span class="dot">●</span>
            </div>
        </div>
    `;
    
    container.appendChild(waitingDiv);
    
    // Füge CSS für die Warteanimation hinzu
    const style = document.createElement('style');
    style.textContent = `
        .waiting-for-map {
            text-align: center;
            padding: 40px 20px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            margin: 20px 0;
        }
        
        .map-generation-info h3 {
            color: #4CAF50;
            margin-bottom: 20px;
            font-size: 1.8em;
        }
        
        .loading-spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top: 4px solid #4CAF50;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        
        .progress-dots {
            margin-top: 20px;
        }
        
        .progress-dots .dot {
            display: inline-block;
            margin: 0 5px;
            font-size: 1.5em;
            opacity: 0.3;
            animation: blink 1.5s infinite;
        }
        
        .progress-dots .dot:nth-child(1) { animation-delay: 0s; }
        .progress-dots .dot:nth-child(2) { animation-delay: 0.5s; }
        .progress-dots .dot:nth-child(3) { animation-delay: 1s; }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        @keyframes blink {
            0%, 50% { opacity: 0.3; }
            25% { opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

    showRaceDetails(raceId) {
        console.log(`📋 Loading race details for race ${raceId}`);
        
        this.socket.emit('get_race_details', {
            raceId: raceId,
            gameId: this.gameDbId
        });

        // Loading-Anzeige im Modal
        this.showRaceDetailsModal();
        this.showRaceDetailsLoading();
    }

    handleRaceDetailsLoaded(data) {
        if (!data.success) {
            this.showError('Fehler beim Laden der Rassendetails: ' + data.message);
            this.closeRaceDetailsModal();
            return;
        }

        console.log(`✅ Race details loaded for ${data.race.name}`);
        this.renderRaceDetails(data.race, data.units);
    }

    showRaceDetailsModal() {
        const modal = document.getElementById('raceDetailsModal');
        if (modal) {
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
        }
    }

    showRaceDetailsLoading() {
        const content = document.getElementById('raceDetailsContent');
        if (content) {
            content.innerHTML = `
                <div class="race-details-loading">
                    <div class="spinner"></div>
                    <p>Lade Rassendetails...</p>
                </div>
            `;
        }
    }

    renderRaceDetails(race, units) {
        const content = document.getElementById('raceDetailsContent');
        if (!content) return;

        // Berechne Durchschnittswerte
        const avgCost = Math.round(units.reduce((sum, u) => sum + u.cost, 0) / units.length);
        const avgAttack = Math.round(units.reduce((sum, u) => sum + u.attack_power, 0) / units.length);
        const avgHealth = Math.round(units.reduce((sum, u) => sum + u.health, 0) / units.length);
        const avgMovement = Math.round(units.reduce((sum, u) => sum + u.movement_points, 0) / units.length * 10) / 10;

        content.innerHTML = `
            <div class="race-details">
                <div class="race-details-header">
                    <h2>${race.name}</h2>
                    <div class="race-color-indicator" style="background-color: ${race.color_hex}"></div>
                    <div class="race-description-full">
                        ${race.description || 'Keine detaillierte Beschreibung verfügbar.'}
                    </div>
                </div>

                <div class="race-stats-summary">
                    <h4>Rassenstärken im Überblick</h4>
                    <div class="summary-stats">
                        <div class="summary-stat">
                            <span class="summary-stat-value">${avgCost}</span>
                            <span class="summary-stat-label">Ø Kosten</span>
                        </div>
                        <div class="summary-stat">
                            <span class="summary-stat-value">${avgAttack}</span>
                            <span class="summary-stat-label">Ø Angriff</span>
                        </div>
                        <div class="summary-stat">
                            <span class="summary-stat-value">${avgHealth}</span>
                            <span class="summary-stat-label">Ø Leben</span>
                        </div>
                        <div class="summary-stat">
                            <span class="summary-stat-value">${avgMovement}</span>
                            <span class="summary-stat-label">Ø Bewegung</span>
                        </div>
                    </div>
                </div>

                <div class="units-section">
                    <h3>Verfügbare Einheiten (${units.length})</h3>
                    <div class="units-grid">
                        ${units.map(unit => this.createUnitCard(unit)).join('')}
                    </div>
                </div>

                <div class="race-details-actions">
                    <button class="btn btn-select" onclick="raceClient.selectRaceFromModal(${race.id})">
                        ${race.name} auswählen
                    </button>
                    <button class="btn btn-back" onclick="raceClient.closeRaceDetailsModal()">
                        Schließen
                    </button>
                </div>
            </div>
        `;
    }

    createUnitCard(unit) {
        const unitType = this.determineUnitType(unit);
        
        return `
            <div class="unit-card ${unitType}">
                <div class="unit-header">
                    <span class="unit-name">${unit.name}</span>
                    <span class="unit-cost">${unit.cost} Gold</span>
                </div>
                <div class="unit-stats">
                    <div class="stat-item attack" title="Angriffsstärke">
                        <span class="stat-label">⚔️ Angriff</span>
                        <span class="stat-value">${unit.attack_power}</span>
                    </div>
                    <div class="stat-item health" title="Lebenspunkte">
                        <span class="stat-label">❤️ Leben</span>
                        <span class="stat-value">${unit.health}</span>
                    </div>
                    <div class="stat-item movement" title="Bewegungspunkte">
                        <span class="stat-label">👟 Bewegung</span>
                        <span class="stat-value">${unit.movement_points}</span>
                    </div>
                    <div class="stat-item range" title="Angriffsreichweite">
                        <span class="stat-label">🎯 Reichweite</span>
                        <span class="stat-value">${unit.attack_range}</span>
                    </div>
                </div>
                ${unit.description ? `<div class="unit-description">${unit.description}</div>` : ''}
            </div>
        `;
    }

    determineUnitType(unit) {
        // Einfache Kategorisierung basierend auf Attributen
        if (unit.attack_range > 2) return 'ranged';
        if (unit.movement_points >= 4) return 'flying';
        if (unit.attack_power >= 25) return 'magic';
        if (unit.health >= 120) return 'support';
        return 'melee';
    }

    selectRaceFromModal(raceId) {
        this.closeRaceDetailsModal();
        this.selectRace(raceId);
    }

    closeRaceDetailsModal() {
        const modal = document.getElementById('raceDetailsModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = ''; // Restore scrolling
        }
    }

    goBackToLobby() {
        if (this.isConfirmed) {
            if (!confirm('Du hast bereits eine Rasse bestätigt. Möchtest du wirklich zur Lobby zurückkehren?')) {
                return;
            }
        }
        
        console.log('🚪 Going back to lobby...');
        
        // Socket-Events für das Verlassen senden
        this.socket.emit('leave_race_selection', {
            gameId: this.gameDbId,
            playerName: this.playerName
        });
        
        // Zurück zur Lobby
        window.location.href = '/';
    }

    updateRaceCardStyles() {
        document.querySelectorAll('.race-card').forEach(card => {
            card.classList.remove('selected');
        });

        if (this.selectedRace) {
            const selectedCard = document.querySelector(`[data-race-id="${this.selectedRace.id}"]`);
            if (selectedCard) {
                selectedCard.classList.add('selected');
            }
        }
    }

    updateSelectionStatus(message) {
        const statusEl = document.getElementById('selectionStatus');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    updatePlayerCount() {
        const readyEl = document.getElementById('playersReady');
        const totalEl = document.getElementById('totalPlayers');
        
        if (readyEl) readyEl.textContent = this.readyPlayers;
        if (totalEl) totalEl.textContent = this.totalPlayers;
    }

    enableConfirmButton() {
        const confirmBtn = document.getElementById('confirmBtn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
        }
    }

    disableConfirmButton() {
        const confirmBtn = document.getElementById('confirmBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
        }
    }

    showChangeButton() {
        const changeBtn = document.getElementById('changeBtn');
        if (changeBtn) {
            changeBtn.style.display = 'inline-block';
        }
    }

    hideChangeButton() {
        const changeBtn = document.getElementById('changeBtn');
        if (changeBtn) {
            changeBtn.style.display = 'none';
        }
    }

    showWaitingArea() {
        const waitingArea = document.getElementById('waitingArea');
        if (waitingArea) {
            waitingArea.style.display = 'block';
        }
    }

    hideWaitingArea() {
        const waitingArea = document.getElementById('waitingArea');
        if (waitingArea) {
            waitingArea.style.display = 'none';
        }
    }

    setUILoading(loading) {
        const buttons = document.querySelectorAll('.btn');
        buttons.forEach(btn => {
            btn.disabled = loading;
        });
    }

    showError(message) {
        console.error('❌ Error:', message);
        
        // Zeige Fehler in der Status-Zeile
        this.updateSelectionStatus(`Fehler: ${message}`);
        
        // Optional: Toast-Notification oder Modal
        alert(message);
    }

    // Chat-Funktionen (falls benötigt)
    handleChatMessage(data) {
        console.log('💬 Chat message received:', data);
        // Chat-Implementierung hier...
    }

    handleChatHistory(data) {
        console.log('📜 Chat history received:', data);
        // Chat-Historie laden...
    }
	
	showProgress(message, percentage) {
    // Zeige Fortschrittsanzeige
    const progressContainer = document.getElementById('progressContainer') || this.createProgressContainer();
    const progressBar = progressContainer.querySelector('.progress-bar');
    const progressText = progressContainer.querySelector('.progress-text');
    
    if (progressBar) {
        progressBar.style.width = percentage + '%';
    }
    
    if (progressText) {
        progressText.textContent = message;
    }
    
    progressContainer.style.display = 'block';
}

createProgressContainer() {
    const container = document.createElement('div');
    container.id = 'progressContainer';
    container.className = 'progress-container';
    container.innerHTML = `
        <div class="progress-wrapper">
            <div class="progress-text">Vorbereitung...</div>
            <div class="progress-track">
                <div class="progress-bar"></div>
            </div>
        </div>
    `;
    
    // CSS für Progress Bar
    const style = document.createElement('style');
    style.textContent = `
        .progress-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            color: white;
        }
        
        .progress-wrapper {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            padding: 30px;
            border-radius: 10px;
            backdrop-filter: blur(10px);
        }
        
        .progress-text {
            font-size: 18px;
            margin-bottom: 20px;
            font-weight: 600;
        }
        
        .progress-track {
            width: 300px;
            height: 6px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 3px;
            overflow: hidden;
        }
        
        .progress-bar {
            height: 100%;
            background: linear-gradient(45deg, #667eea, #764ba2);
            width: 0%;
            transition: width 0.5s ease;
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(container);
    return container;
}

showNotification(message, type = 'info') {
    console.log(`Notification (${type}):`, message);
    
    // Erstelle oder finde Notification Container
    let notification = document.getElementById('raceNotification');
    if (!notification) {
        notification = this.createNotificationElement();
    }
    
    // Setze Nachricht und Typ
    notification.textContent = message;
    notification.className = `race-notification ${type} show`;
    
    // Auto-hide nach 4 Sekunden
    setTimeout(() => {
        notification.classList.remove('show');
    }, 4000);
}

createNotificationElement() {
    const notification = document.createElement('div');
    notification.id = 'raceNotification';
    notification.className = 'race-notification';
    
    // CSS für Notifications
    const style = document.createElement('style');
    style.textContent = `
        .race-notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 6px;
            color: white;
            font-weight: 600;
            z-index: 10001;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            min-width: 300px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .race-notification.show {
            transform: translateX(0);
        }
        
        .race-notification.success {
            background: #28a745;
        }
        
        .race-notification.error {
            background: #dc3545;
        }
        
        .race-notification.info {
            background: #17a2b8;
        }
        
        .race-notification.warning {
            background: #ffc107;
            color: #212529;
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(notification);
    return notification;
}

showSuccess(message) {
    this.showNotification(message, 'success');
}

showError(message) {
    this.showNotification(message, 'error');
}

showInfo(message) {
    this.showNotification(message, 'info');
}

showWarning(message) {
    this.showNotification(message, 'warning');
}
}

// Client initialisieren
let raceClient;
document.addEventListener('DOMContentLoaded', () => {
    raceClient = new RaceSelectionClient();
    window.raceClient = raceClient; // Für globalen Zugriff
});