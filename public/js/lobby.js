// Lobby JavaScript - Frontend logic for improved lobby

class LobbyManager {
    constructor() {
        this.socket = null;
        this.currentGameId = null;
        this.gameState = null;
        this.playerName = '';
        this.availableRaces = [];
        this.currentPlayers = [];
        this.isReady = false;
        this.isHost = false;
        this.selectedRaceId = null;
        this.raceConfirmed = false;
        this.gameDbId = null; // Database ID after game starts
        this.playersRaceStatus = new Map(); // Track all players' race status
        
        this.init();
    }

    init() {
        this.setupSocket();
        this.setupEventListeners();
        this.loadPlayerName();
        this.loadAvailableGames();
        this.loadRaces();
    }

    setupSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Verbunden mit Server');
            showNotification('Mit Server verbunden', 'success');
        });

        this.socket.on('disconnect', () => {
            console.log('Verbindung zum Server verloren');
            showNotification('Verbindung zum Server verloren', 'error');
            this.hideCurrentGameLobby();
        });

        this.socket.on('error', (error) => {
            console.error('Socket Error:', error);
            showNotification(error, 'error');
        });

        // Game events
        this.socket.on('game_created', (data) => {
            showNotification('Spiel erfolgreich erstellt!', 'success');
            this.isHost = data.isHost;
            this.currentGameId = data.gameId;
            this.showCurrentGameLobby(data);
        });

        this.socket.on('game_joined', (data) => {
            showNotification('Spiel erfolgreich beigetreten!', 'success');
            this.isHost = data.isHost;
            this.currentGameId = data.gameId;
            this.showCurrentGameLobby(data);
        });

        this.socket.on('games_updated', (games) => {
            console.log('Games list updated:', games);
            this.updateGamesList(games);
        });

        this.socket.on('player_joined', (data) => {
            showNotification(`${data.playerName} ist dem Spiel beigetreten`, 'info');
        });

        this.socket.on('player_left', (data) => {
            showNotification(`${data.playerName} hat das Spiel verlassen`, 'warning');
        });

        this.socket.on('game_left', (data) => {
            if (data.gameDeleted) {
                showNotification('Spiel wurde gelöscht (letzter Spieler)', 'info');
            } else {
                showNotification('Du hast das Spiel verlassen', 'info');
            }
            this.hideCurrentGameLobby();
        });

        this.socket.on('lobby_players_updated', (players) => {
            this.updateCurrentGamePlayersList(players);
        });

        this.socket.on('player_ready_status', (data) => {
            this.updateReadyStatus(data);
        });

        this.socket.on('player_ready_notification', (data) => {
            showNotification(`${data.playerName} ist ${data.ready ? 'bereit' : 'nicht bereit'}`, 'info');
        });

        this.socket.on('db_game_created', (data) => {
            console.log('DB Game created event received:', data);
            this.gameDbId = data.dbGameId;
            this.currentGameId = null; // Clear memory game ID
            
            saveToLocalStorage('currentDbGameId', this.gameDbId);
            saveToLocalStorage('currentGameId', null);
            
            showNotification(`Spiel in Datenbank erstellt (ID: ${data.dbGameId})`, 'info');
        });

        this.socket.on('start_race_selection', (data) => {
            console.log('Starting race selection with data:', data);
            
            // Ensure we have the correct DB game ID
            if (data.dbGameId) {
                this.gameDbId = data.dbGameId;
                saveToLocalStorage('currentDbGameId', this.gameDbId);
            }
            
            // Initialize players race status
            if (data.players) {
                this.playersRaceStatus.clear();
                data.players.forEach(player => {
                    this.playersRaceStatus.set(player.name, {
                        playerName: player.name,
                        selectedRaceId: null,
                        confirmed: false,
                        raceName: null
                    });
                });
            }
            
            this.hideCurrentGameLobby();
            this.startRaceSelection();
        });

        this.socket.on('db_game_id_assigned', (data) => {
            console.log('DB Game ID assigned:', data);
            this.gameDbId = data.dbGameId;
            saveToLocalStorage('currentDbGameId', this.gameDbId);
            
            // If race selection modal is already open, update the ID
            if (document.getElementById('raceSelectionModal').style.display === 'block') {
                showNotification(`Spiel-ID erhalten: ${data.dbGameId}`, 'info');
            }
        });

        this.socket.on('race_selection_confirmed', (data) => {
            showNotification(`Rasse bestätigt: ${data.raceName}`, 'success');
            
            this.raceConfirmed = true;
            
            // Update UI to show confirmed selection
            const statusEl = document.getElementById('raceSelectionStatus');
            if (statusEl) {
                statusEl.textContent = `✅ ${data.raceName} bestätigt! Warte auf andere Spieler...`;
                statusEl.classList.add('confirmed');
            }
            
            // Update buttons
            this.updateRaceSelectionButtons();
            
            // Update race card to confirmed state
            const raceCard = document.querySelector(`[data-race-id="${data.raceId}"]`);
            if (raceCard) {
                raceCard.classList.remove('selected');
                raceCard.classList.add('confirmed');
                
                // Add confirmed indicator
                const confirmedIndicator = document.createElement('div');
                confirmedIndicator.className = 'confirmed-indicator';
                confirmedIndicator.textContent = 'Bestätigt';
                raceCard.appendChild(confirmedIndicator);
            }
        });

        this.socket.on('player_race_selected', (data) => {
            // Update local tracking of player selections (live updates)
            this.playersRaceStatus.set(data.playerName, {
                playerName: data.playerName,
                selectedRaceId: data.raceId,
                confirmed: false,
                raceName: data.raceName
            });
            
            if (data.playerName !== this.playerName) {
                showNotification(`${data.playerName} wählt ${data.raceName}`, 'info');
            }
            
            // Update both player status and race cards for live feedback
            this.updatePlayersRaceStatus();
            this.updateRaceCardsDisplay();
        });

        this.socket.on('player_race_confirmed', (data) => {
            // Update player status to confirmed
            const playerStatus = this.playersRaceStatus.get(data.playerName);
            if (playerStatus) {
                playerStatus.confirmed = true;
                playerStatus.selectedRaceId = data.raceId;
                playerStatus.raceName = data.raceName;
            }
            
            if (data.playerName !== this.playerName) {
                showNotification(`${data.playerName} hat ${data.raceName} bestätigt`, 'success');
            }
            
            this.updatePlayersRaceStatus();
            this.updateRaceCardsDisplay();
            this.updateRaceSelectionStatus(data.confirmedCount, data.totalPlayers);
        });

        this.socket.on('player_race_deselected', (data) => {
            console.log('Player race deselected:', data);
            
            // Update local tracking - player deselected race
            const playerStatus = this.playersRaceStatus.get(data.playerName);
            if (playerStatus) {
                playerStatus.selectedRaceId = null;
                playerStatus.confirmed = false;
                playerStatus.raceName = null;
            }
            
            if (data.playerName !== this.playerName) {
                const action = data.wasConfirmed ? 'bestätigte Rasse zurückgesetzt' : 'Auswahl zurückgesetzt';
                showNotification(`${data.playerName} hat ${action}`, 'info');
            }
            
            this.updatePlayersRaceStatus();
            this.updateRaceCardsDisplay();
        });

        this.socket.on('race_deselection_confirmed', (data) => {
            console.log('Race deselection confirmed:', data.message);
            // Don't show notification here as it's already shown in changeRaceSelection()
        });

        this.socket.on('game_started', (data) => {
            showNotification('Spiel startet! Weiterleitung...', 'success');
            hideModal('raceSelectionModal');
            setTimeout(() => {
                window.location.href = `/game/${data.dbGameId}`;
            }, 2000);
        });

        // Join database game room after race selection starts
        this.socket.on('join_db_game_room', (data) => {
            this.socket.emit('join_db_game_room', {
                gameId: data.dbGameId,
                playerName: this.playerName
            });
        });
    }

    setupEventListeners() {
        // Player name input
        const playerNameInput = document.getElementById('playerName');
        if (playerNameInput) {
            playerNameInput.addEventListener('input', debounce((e) => {
                this.playerName = e.target.value.trim();
                this.savePlayerName();
            }, 500));
        }

        // Create game button
        const createGameBtn = document.getElementById('createGameBtn');
        if (createGameBtn) {
            createGameBtn.addEventListener('click', () => {
                this.createGame();
            });
        }

        // Refresh games button
        const refreshGamesBtn = document.getElementById('refreshGamesBtn');
        if (refreshGamesBtn) {
            refreshGamesBtn.addEventListener('click', () => {
                this.loadAvailableGames();
            });
        }

        // Lobby control buttons
        const readyBtn = document.getElementById('readyBtn');
        if (readyBtn) {
            readyBtn.addEventListener('click', () => {
                this.toggleReady();
            });
        }

        const startGameBtn = document.getElementById('startGameBtn');
        if (startGameBtn) {
            startGameBtn.addEventListener('click', () => {
                this.startGame();
            });
        }

        const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
        if (leaveLobbyBtn) {
            leaveLobbyBtn.addEventListener('click', () => {
                this.leaveLobby();
            });
        }

        // Race confirmation button
        const confirmRaceBtn = document.getElementById('confirmRaceBtn');
        if (confirmRaceBtn) {
            confirmRaceBtn.addEventListener('click', () => {
                this.confirmRaceSelection();
            });
        }
        
        // Change race button
        const changeRaceBtn = document.getElementById('changeRaceBtn');
        if (changeRaceBtn) {
            changeRaceBtn.addEventListener('click', () => {
                this.changeRaceSelection();
            });
        }

        // Enter key submit
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const activeElement = document.activeElement;
                if (activeElement && (activeElement.id === 'playerName' || activeElement.id === 'gameName')) {
                    this.createGame();
                }
            }
        });
    }

    loadPlayerName() {
        const savedName = loadFromLocalStorage('playerName', '');
        if (savedName) {
            const playerNameInput = document.getElementById('playerName');
            if (playerNameInput) {
                playerNameInput.value = savedName;
                this.playerName = savedName;
            }
        }
    }

    savePlayerName() {
        saveToLocalStorage('playerName', this.playerName);
    }

    async loadAvailableGames() {
        try {
            const response = await fetch('/api/games');
            const games = await response.json();
            this.updateGamesList(games);
        } catch (error) {
            console.error('Error loading games:', error);
            showNotification('Fehler beim Laden der Spiele', 'error');
        }
    }

    async loadRaces() {
        try {
            const response = await fetch('/api/races');
            this.availableRaces = await response.json();
        } catch (error) {
            console.error('Error loading races:', error);
            showNotification('Fehler beim Laden der Rassen', 'error');
        }
    }

    updateGamesList(games) {
        const gamesList = document.getElementById('gamesList');
        if (!gamesList) return;
        
        if (games.length === 0) {
            gamesList.innerHTML = '<div class="loading">Keine Spiele verfügbar</div>';
            return;
        }

        gamesList.innerHTML = games.map(game => `
            <div class="game-item" data-game-id="${game.id}" data-game-name="${game.name}" 
                 data-max-players="${game.maxPlayers}" data-map-size="${game.mapSize}">
                <h4>${game.name}</h4>
                <div class="game-details">
                    <span>Spieler: ${game.currentPlayers}/${game.maxPlayers}</span>
                    <span>Karte: ${game.mapSize}x${game.mapSize}</span>
                    <span>Status: ${this.getStatusText(game.status)}</span>
                </div>
                <div class="players-list">
                    <strong>Spieler:</strong> ${game.players && game.players.length > 0 ? game.players.join(', ') : 'Keine'}
                </div>
            </div>
        `).join('');

        // Add click listeners to game items
        gamesList.querySelectorAll('.game-item').forEach(item => {
            item.addEventListener('click', () => {
                const gameId = parseInt(item.dataset.gameId);
                const gameName = item.dataset.gameName;
                const maxPlayers = parseInt(item.dataset.maxPlayers);
                const mapSize = parseInt(item.dataset.mapSize);
                
                this.joinGame(gameId, gameName, maxPlayers, mapSize);
            });
        });
    }

    getStatusText(status) {
        switch(status) {
            case 'waiting': return 'Wartet auf Spieler';
            case 'race_selection': return 'Rassenwahl';
            case 'playing': return 'Spiel läuft';
            default: return status;
        }
    }

    createGame() {
        // Validate input
        const nameValidation = validatePlayerName(this.playerName);
        if (!nameValidation.valid) {
            showNotification(nameValidation.message, 'error');
            return;
        }

        const gameNameInput = document.getElementById('gameName');
        if (!gameNameInput) return;
        
        const gameName = gameNameInput.value;
        const gameNameValidation = validateGameName(gameName);
        if (!gameNameValidation.valid) {
            showNotification(gameNameValidation.message, 'error');
            return;
        }

        const maxPlayersSelect = document.getElementById('maxPlayers');
        const mapSizeSelect = document.getElementById('mapSize');
        if (!maxPlayersSelect || !mapSizeSelect) return;

        const maxPlayers = parseInt(maxPlayersSelect.value);
        const mapSize = parseInt(mapSizeSelect.value);

        console.log('Creating game with:', {
            playerName: this.playerName,
            gameName: gameName.trim(),
            maxPlayers: maxPlayers,
            mapSize: mapSize
        });

        this.socket.emit('create_game', {
            playerName: this.playerName,
            gameName: gameName.trim(),
            maxPlayers: maxPlayers,
            mapSize: mapSize
        });
    }

    joinGame(gameId, gameName, maxPlayers, mapSize) {
        // Validate player name
        const nameValidation = validatePlayerName(this.playerName);
        if (!nameValidation.valid) {
            showNotification(nameValidation.message, 'error');
            return;
        }

        console.log('Joining game:', {
            gameId: gameId,
            playerName: this.playerName
        });

        this.socket.emit('join_game', {
            gameId: gameId,
            playerName: this.playerName
        });
    }

    // Show current game lobby (inline, not modal)
    showCurrentGameLobby(data) {
        const currentGameSection = document.getElementById('currentGameSection');
        const currentGameName = document.getElementById('currentGameName');
        const currentGamePlayerCount = document.getElementById('currentGamePlayerCount');
        const currentGameMaxPlayers = document.getElementById('currentGameMaxPlayers');
        const currentGameMapSize = document.getElementById('currentGameMapSize');
        const currentGameMapSizeY = document.getElementById('currentGameMapSizeY');
        const startBtn = document.getElementById('startGameBtn');
        
        if (currentGameName) currentGameName.textContent = data.gameName;
        if (currentGamePlayerCount) currentGamePlayerCount.textContent = data.players.length;
        if (currentGameMaxPlayers) currentGameMaxPlayers.textContent = data.maxPlayers;
        if (currentGameMapSize) currentGameMapSize.textContent = data.mapSize;
        if (currentGameMapSizeY) currentGameMapSizeY.textContent = data.mapSize;
        
        // Show/hide start button based on host status
        if (startBtn) {
            if (this.isHost) {
                startBtn.style.display = 'inline-block';
                startBtn.disabled = true; // Initially disabled until all players are ready
            } else {
                startBtn.style.display = 'none';
            }
        }
        
        // Show the section
        if (currentGameSection) {
            currentGameSection.style.display = 'block';
        }
        
        // Update players list
        this.updateCurrentGamePlayersList(data.players);
    }

    // Hide current game lobby
    hideCurrentGameLobby() {
        const currentGameSection = document.getElementById('currentGameSection');
        if (currentGameSection) {
            currentGameSection.style.display = 'none';
        }
        
        this.currentGameId = null;
        this.isReady = false;
        this.isHost = false;
        this.selectedRaceId = null;
        this.raceConfirmed = false;
        this.gameDbId = null;
        this.playersRaceStatus.clear();
        
        // Reset ready button
        const readyBtn = document.getElementById('readyBtn');
        if (readyBtn) {
            readyBtn.textContent = 'Bereit';
            readyBtn.classList.remove('btn-secondary');
            readyBtn.classList.add('btn-success');
        }
        
        // Reset start button
        const startBtn = document.getElementById('startGameBtn');
        if (startBtn) {
            startBtn.style.display = 'none';
            startBtn.disabled = true;
        }
    }

    // Update current game players list
    updateCurrentGamePlayersList(players) {
        const playersList = document.getElementById('currentGamePlayersList');
        if (!playersList) return;
        
        playersList.innerHTML = players.map(player => `
            <li class="lobby-player-item">
                <div class="player-info">
                    <span class="player-name">
                        ${player.player_name}
                        ${player.is_host ? ' 👑' : ''}
                    </span>
                    <span class="player-status">
                        ${player.is_ready ? '✅ Bereit' : '⏳ Wartet'}
                    </span>
                </div>
            </li>
        `).join('');
        
        // Update player count
        const currentGamePlayerCount = document.getElementById('currentGamePlayerCount');
        const totalPlayers = document.getElementById('totalPlayers');
        
        if (currentGamePlayerCount) currentGamePlayerCount.textContent = players.length;
        if (totalPlayers) totalPlayers.textContent = players.length;
        
        this.currentPlayers = players;
        
        // Check if current player became host
        const currentPlayer = players.find(p => p.player_name === this.playerName);
        if (currentPlayer) {
            this.isHost = currentPlayer.is_host;
            
            // Update start button visibility
            const startBtn = document.getElementById('startGameBtn');
            if (startBtn) {
                if (this.isHost) {
                    startBtn.style.display = 'inline-block';
                } else {
                    startBtn.style.display = 'none';
                }
            }
        }
    }

    updateReadyStatus(data) {
        const readyCount = document.getElementById('readyCount');
        const totalPlayers = document.getElementById('totalPlayers');
        const lobbyStatusText = document.getElementById('lobbyStatusText');
        const startBtn = document.getElementById('startGameBtn');
        
        if (readyCount) readyCount.textContent = data.readyCount;
        if (totalPlayers) totalPlayers.textContent = data.totalPlayers;
        
        if (data.allReady && this.isHost) {
            if (lobbyStatusText) lobbyStatusText.textContent = 'Alle Spieler bereit! Du kannst das Spiel starten.';
            if (startBtn) startBtn.disabled = false;
        } else if (data.allReady) {
            if (lobbyStatusText) lobbyStatusText.textContent = 'Alle Spieler bereit! Warte auf Host...';
        } else {
            if (lobbyStatusText) lobbyStatusText.textContent = 'Warte auf andere Spieler...';
            if (this.isHost && startBtn) {
                startBtn.disabled = true;
            }
        }
        
        // Update players list with new ready states
        if (data.players) {
            this.updateCurrentGamePlayersList(data.players);
        }
    }

    toggleReady() {
        if (!this.currentGameId) return;

        this.isReady = !this.isReady;
        
        console.log('Toggling ready status:', this.isReady);
        
        this.socket.emit('player_ready', {
            gameId: this.currentGameId,
            playerName: this.playerName,
            ready: this.isReady
        });

        const readyBtn = document.getElementById('readyBtn');
        if (readyBtn) {
            if (this.isReady) {
                readyBtn.textContent = 'Nicht bereit';
                readyBtn.classList.remove('btn-success');
                readyBtn.classList.add('btn-secondary');
            } else {
                readyBtn.textContent = 'Bereit';
                readyBtn.classList.remove('btn-secondary');
                readyBtn.classList.add('btn-success');
            }
        }
    }

    startGame() {
        if (!this.currentGameId || !this.isHost) return;

        console.log('Starting game:', this.currentGameId);

        this.socket.emit('start_game', {
            gameId: this.currentGameId,
            playerName: this.playerName
        });
    }

    leaveLobby() {
        if (this.currentGameId) {
            console.log('Leaving game:', this.currentGameId);
            
            // Send leave game event to server
            this.socket.emit('leave_game', {
                gameId: this.currentGameId,
                playerName: this.playerName
            });
        }
        
        this.hideCurrentGameLobby();
        
        // Refresh games list
        this.loadAvailableGames();
    }

    startRaceSelection() {
        console.log('Starting race selection modal');
        console.log('Available races:', this.availableRaces.length);
        console.log('Current gameDbId:', this.gameDbId);
        console.log('Current playerName:', this.playerName);
        
        this.setupRaceSelectionModal();
        showModal('raceSelectionModal');
        
        // Add debug info to modal if needed
        const modal = document.getElementById('raceSelectionModal');
        if (modal && !this.gameDbId) {
            const debugInfo = document.createElement('div');
            debugInfo.style.cssText = 'background: #f39c12; color: white; padding: 0.5rem; margin-bottom: 1rem; border-radius: 4px;';
            debugInfo.innerHTML = `
                <strong>⚠️ Debug Info:</strong><br>
                Spiel-ID: ${this.gameDbId || 'FEHLT'}<br>
                Memory Game ID: ${this.currentGameId || 'FEHLT'}<br>
                Spieler: ${this.playerName || 'FEHLT'}
            `;
            const modalBody = modal.querySelector('.modal-body');
            if (modalBody) {
                modalBody.insertBefore(debugInfo, modalBody.firstChild);
            }
        }
    }

    setupRaceSelectionModal() {
        const racesList = document.getElementById('racesList');
        if (!racesList || !this.availableRaces.length) return;
        
        // Clear any existing race card states first
        this.resetAllRaceCards();
        
        racesList.innerHTML = this.availableRaces.map(race => `
            <div class="race-card" data-race-id="${race.id}">
                <div class="race-color" style="background-color: ${race.color_hex}"></div>
                <h4>${race.name}</h4>
                <p>${race.description}</p>
            </div>
        `).join('');

        // Add click listeners to race cards
        racesList.querySelectorAll('.race-card').forEach(card => {
            card.addEventListener('click', () => {
                const raceId = parseInt(card.dataset.raceId);
                this.selectRace(raceId);
            });
        });

        // Apply current state
        this.applyCurrentRaceStates();

        // Initialize status displays
        this.updateRaceSelectionStatus();
        this.updatePlayersRaceStatus();
        this.updateRaceSelectionButtons();
    }

    resetAllRaceCards() {
        const allRaceCards = document.querySelectorAll('.race-card');
        allRaceCards.forEach(card => {
            card.classList.remove('selected', 'confirmed', 'unavailable');
            card.style.pointerEvents = '';
            card.style.position = '';
            
            // Remove all indicators
            const indicators = card.querySelectorAll('.taken-indicator, .confirmed-indicator');
            indicators.forEach(indicator => indicator.remove());
        });
    }

    applyCurrentRaceStates() {
        // Apply states based on current playersRaceStatus
        this.playersRaceStatus.forEach((status, playerName) => {
            if (status.confirmed && status.selectedRaceId) {
                this.updateRaceSelection(status.selectedRaceId, playerName);
            }
        });
        
        // Apply own selection if any
        if (this.selectedRaceId) {
            const ownCard = document.querySelector(`[data-race-id="${this.selectedRaceId}"]`);
            if (ownCard) {
                if (this.raceConfirmed) {
                    ownCard.classList.add('confirmed');
                } else {
                    ownCard.classList.add('selected');
                }
            }
        }
    }

    selectRace(raceId) {
        console.log('Selecting race:', raceId);
        
        // Don't allow selection if already confirmed
        if (this.raceConfirmed) {
            showNotification('Du hast bereits eine Rasse bestätigt. Klicke auf "Rasse ändern" um eine neue zu wählen.', 'warning');
            return;
        }

        // Update UI to show new selection
        document.querySelectorAll('.race-card').forEach(card => {
            if (card.classList.contains('own-selection')) {
                card.classList.remove('own-selection');
            }
        });
        
        const raceCard = document.querySelector(`[data-race-id="${raceId}"]`);
        if (raceCard) {
            raceCard.classList.add('own-selection');
        }

        this.selectedRaceId = raceId;

        // Show selected race info
        const selectedRace = this.availableRaces.find(race => race.id === raceId);
        if (selectedRace) {
            const selectedRaceInfo = document.getElementById('selectedRaceInfo');
            if (selectedRaceInfo) {
                selectedRaceInfo.innerHTML = `
                    <h4>Ausgewählt: ${selectedRace.name}</h4>
                    <p>${selectedRace.description}</p>
                    <p style="color: ${selectedRace.color_hex}; font-weight: bold;">
                        Deine Farbe: ${selectedRace.color_hex}
                    </p>
                    <small>Klicke auf "Rasse bestätigen" um deine Wahl zu bestätigen.</small>
                `;
            }
        }

        // Update buttons and status
        this.updateRaceSelectionButtons();
        this.updateRaceSelectionStatus();
        
        // Notify server about selection (live update)
        this.notifyRaceSelection(raceId, false);
    }

    updateRaceCardsDisplay() {
        // Reset all race cards
        document.querySelectorAll('.race-card').forEach(card => {
            // Remove all player indicators
            const indicators = card.querySelectorAll('.race-players-indicator');
            indicators.forEach(indicator => indicator.remove());
            
            // Reset classes (keep own selection)
            const isOwnSelection = card.classList.contains('own-selection');
            card.className = 'race-card';
            if (isOwnSelection && !this.raceConfirmed) {
                card.classList.add('own-selection');
            }
        });

        // Group players by race
        const raceGroups = new Map();
        this.playersRaceStatus.forEach((status, playerName) => {
            if (status.selectedRaceId) {
                if (!raceGroups.has(status.selectedRaceId)) {
                    raceGroups.set(status.selectedRaceId, []);
                }
                raceGroups.get(status.selectedRaceId).push(status);
            }
        });

        // Add indicators for each race
        raceGroups.forEach((players, raceId) => {
            const raceCard = document.querySelector(`[data-race-id="${raceId}"]`);
            if (raceCard) {
                // Create players indicator
                const indicator = document.createElement('div');
                indicator.className = 'race-players-indicator';
                
                const confirmedPlayers = players.filter(p => p.confirmed);
                const unconfirmedPlayers = players.filter(p => !p.confirmed);
                
                let indicatorText = '';
                if (confirmedPlayers.length > 0) {
                    indicatorText += `✅ ${confirmedPlayers.map(p => p.playerName).join(', ')}`;
                }
                if (unconfirmedPlayers.length > 0) {
                    if (indicatorText) indicatorText += ' ';
                    indicatorText += `🤔 ${unconfirmedPlayers.map(p => p.playerName).join(', ')}`;
                }
                
                indicator.textContent = indicatorText;
                indicator.style.cssText = `
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: rgba(52, 152, 219, 0.9);
                    color: white;
                    padding: 0.25rem;
                    font-size: 0.7rem;
                    text-align: center;
                    border-radius: 0 0 6px 6px;
                `;
                
                raceCard.style.position = 'relative';
                raceCard.appendChild(indicator);
                
                // Add visual styling based on selection status
                if (confirmedPlayers.length > 0) {
                    raceCard.classList.add('has-confirmed-players');
                } else {
                    raceCard.classList.add('has-selecting-players');
                }
            }
        });

        // Mark own confirmed race
        if (this.raceConfirmed && this.selectedRaceId) {
            const ownCard = document.querySelector(`[data-race-id="${this.selectedRaceId}"]`);
            if (ownCard) {
                ownCard.classList.remove('own-selection');
                ownCard.classList.add('own-confirmed');
            }
        }
    }
    
    confirmRaceSelection() {
        if (!this.selectedRaceId) {
            showNotification('Bitte wähle zuerst eine Rasse aus', 'warning');
            return;
        }
        
        if (this.raceConfirmed) {
            showNotification('Du hast bereits eine Rasse bestätigt', 'warning');
            return;
        }
        
        console.log('Confirming race selection:', this.selectedRaceId);
        
        // Send confirmation to server
        this.notifyRaceSelection(this.selectedRaceId, true);
    }
    
    changeRaceSelection() {
        if (!this.raceConfirmed) {
            showNotification('Du hast noch keine Rasse bestätigt', 'warning');
            return;
        }
        
        console.log('Changing race selection - resetting confirmation status');
        
        // Reset local state first (before any server calls)
        this.raceConfirmed = false;
        const oldRaceId = this.selectedRaceId;
        this.selectedRaceId = null;
        
        // Update own player status locally
        const ownStatus = this.playersRaceStatus.get(this.playerName);
        if (ownStatus) {
            ownStatus.selectedRaceId = null;
            ownStatus.confirmed = false;
            ownStatus.raceName = null;
        }
        
        // Reset UI immediately
        this.resetAllRaceCards();
        this.applyCurrentRaceStates();
        
        const selectedRaceInfo = document.getElementById('selectedRaceInfo');
        if (selectedRaceInfo) {
            selectedRaceInfo.innerHTML = '<p>Wähle eine neue Rasse aus der Liste oben.</p>';
        }
        
        this.updateRaceSelectionButtons();
        this.updateRaceSelectionStatus();
        this.updatePlayersRaceStatus();
        
        // Now notify server about deselection
        this.notifyRaceDeselection();
        
        showNotification('Du kannst jetzt eine neue Rasse wählen', 'info');
    }
    
    notifyRaceDeselection() {
        // Get gameDbId
        let gameDbId = this.gameDbId;
        
        if (!gameDbId) {
            gameDbId = loadFromLocalStorage('currentDbGameId', null);
        }
        
        if (!gameDbId) {
            console.warn('No gameDbId available for race deselection');
            return;
        }
        
        if (!this.playerName) {
            console.warn('No playerName available for race deselection');
            return;
        }

        console.log('Sending race deselection (allowing confirmed races):', {
            gameId: gameDbId,
            playerName: this.playerName
        });

        // Send deselection to server (should work even for confirmed races)
        this.socket.emit('deselect_race', {
            gameId: gameDbId,
            playerName: this.playerName
        });
    }
    
    notifyRaceSelection(raceId, confirmed) {
        // Try to get gameDbId from multiple sources
        let gameDbId = this.gameDbId;
        
        if (!gameDbId) {
            gameDbId = loadFromLocalStorage('currentDbGameId', null);
        }
        
        if (!gameDbId) {
            const urlGameId = getGameIdFromUrl();
            if (urlGameId) {
                gameDbId = urlGameId;
            }
        }
        
        if (!gameDbId) {
            showNotification('Spiel-ID fehlt. Bitte versuche es erneut.', 'error');
            return;
        }
        
        if (!this.playerName) {
            showNotification('Spielername fehlt. Bitte lade die Seite neu.', 'error');
            return;
        }

        console.log('Sending race selection:', {
            gameId: gameDbId,
            playerName: this.playerName,
            raceId: raceId,
            confirmed: confirmed
        });

        // Send selection to server
        this.socket.emit('select_race', {
            gameId: gameDbId,
            playerName: this.playerName,
            raceId: raceId,
            confirmed: confirmed
        });
    }
    
    updateRaceSelectionButtons() {
        const confirmBtn = document.getElementById('confirmRaceBtn');
        const changeBtn = document.getElementById('changeRaceBtn');
        
        if (confirmBtn) {
            if (this.selectedRaceId && !this.raceConfirmed) {
                confirmBtn.disabled = false;
                confirmBtn.style.display = 'inline-block';
            } else {
                confirmBtn.disabled = true;
                if (this.raceConfirmed) {
                    confirmBtn.style.display = 'none';
                }
            }
        }
        
        if (changeBtn) {
            if (this.raceConfirmed) {
                changeBtn.style.display = 'inline-block';
            } else {
                changeBtn.style.display = 'none';
            }
        }
    }
    
    updatePlayersRaceStatus() {
        const statusContainer = document.getElementById('racePlayersStatus');
        if (!statusContainer) return;
        
        const playersArray = Array.from(this.playersRaceStatus.values());
        
        statusContainer.innerHTML = playersArray.map(player => {
            let statusText = 'Wählt noch...';
            let statusClass = '';
            
            if (player.confirmed) {
                statusText = `✅ ${player.raceName} (bestätigt)`;
                statusClass = 'confirmed';
            } else if (player.selectedRaceId) {
                statusText = `🤔 ${player.raceName} (noch nicht bestätigt)`;
                statusClass = 'selecting';
            }
            
            return `
                <div class="player-race-item ${statusClass}">
                    <span class="player-race-name">${player.playerName}</span>
                    <span class="player-race-status ${statusClass}">${statusText}</span>
                </div>
            `;
        }).join('');
    }

    clearPlayerRaceFromUI(playerName, raceId) {
        console.log(`Clearing race ${raceId} from UI for player ${playerName}`);
        
        const raceCard = document.querySelector(`[data-race-id="${raceId}"]`);
        if (raceCard) {
            // Remove all player-specific indicators
            const indicators = raceCard.querySelectorAll('.taken-indicator, .confirmed-indicator');
            indicators.forEach(indicator => {
                if (indicator.textContent.includes(playerName)) {
                    indicator.remove();
                }
            });
            
            // Reset card state if no other indicators exist
            const remainingIndicators = raceCard.querySelectorAll('.taken-indicator, .confirmed-indicator');
            if (remainingIndicators.length === 0) {
                raceCard.classList.remove('unavailable', 'confirmed');
                raceCard.style.pointerEvents = '';
                raceCard.style.position = '';
            }
        }
    }

    updateRaceSelection(raceId, playerName) {
        // First clear any existing indicators for this player from all cards
        this.clearAllPlayerIndicators(playerName);
        
        // Mark race as unavailable for other players (only when confirmed)
        const raceCard = document.querySelector(`[data-race-id="${raceId}"]`);
        if (raceCard && playerName !== this.playerName) {
            raceCard.classList.add('unavailable');
            raceCard.style.pointerEvents = 'none';
            
            // Add taken by indicator
            const takenIndicator = document.createElement('div');
            takenIndicator.className = 'taken-indicator';
            takenIndicator.textContent = `Gewählt von ${playerName}`;
            takenIndicator.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                background: rgba(231, 76, 60, 0.9);
                color: white;
                padding: 0.25rem;
                font-size: 0.7rem;
                text-align: center;
            `;
            raceCard.style.position = 'relative';
            raceCard.appendChild(takenIndicator);
        }
    }

    clearAllPlayerIndicators(playerName) {
        // Remove all indicators for this player from all race cards
        const allRaceCards = document.querySelectorAll('.race-card');
        allRaceCards.forEach(card => {
            const indicators = card.querySelectorAll('.taken-indicator, .confirmed-indicator');
            indicators.forEach(indicator => {
                if (indicator.textContent.includes(playerName)) {
                    indicator.remove();
                    
                    // Reset card state if this was the only indicator
                    const remainingIndicators = card.querySelectorAll('.taken-indicator, .confirmed-indicator');
                    if (remainingIndicators.length === 0) {
                        card.classList.remove('unavailable', 'confirmed');
                        card.style.pointerEvents = '';
                        card.style.position = '';
                    }
                }
            });
        });
    }

    updateRaceSelectionStatus(confirmedCount = null, totalPlayers = null) {
        const statusEl = document.getElementById('raceSelectionStatus');
        if (!statusEl) return;

        if (this.raceConfirmed) {
            if (confirmedCount !== null && totalPlayers !== null) {
                statusEl.textContent = `✅ Rasse bestätigt! (${confirmedCount}/${totalPlayers} Spieler fertig)`;
            } else {
                statusEl.textContent = '✅ Rasse bestätigt! Warte auf andere Spieler...';
            }
            statusEl.classList.add('confirmed');
        } else if (this.selectedRaceId) {
            statusEl.textContent = 'Rasse ausgewählt - klicke auf "Bestätigen"';
            statusEl.style.background = '#f39c12';
            statusEl.classList.remove('confirmed');
        } else {
            statusEl.textContent = 'Wähle deine Rasse aus...';
            statusEl.style.background = '#3498db';
            statusEl.classList.remove('confirmed');
        }
    }
}

// Initialize lobby when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.lobbyManager = new LobbyManager();
});