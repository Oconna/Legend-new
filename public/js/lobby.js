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
        this.gameDbId = null; // Database ID after game starts
        
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
            this.gameDbId = data.dbGameId;
            
            // Save to localStorage as backup
            saveToLocalStorage('currentDbGameId', this.gameDbId);
            
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
            showNotification(`Rasse gewählt: ${data.raceName}`, 'success');
            
            // Update UI to show confirmed selection
            const statusEl = document.getElementById('raceSelectionStatus');
            if (statusEl) {
                statusEl.textContent = `✅ ${data.raceName} gewählt! Warte auf andere Spieler...`;
                statusEl.style.background = '#2ecc71';
            }
        });

        this.socket.on('race_selected', (data) => {
            if (data.playerName !== this.playerName) {
                showNotification(`${data.playerName} hat ${data.raceName} gewählt`, 'info');
                this.updateRaceSelection(data.raceId, data.playerName);
            }
            
            // Update status display with current progress
            this.updateRaceSelectionStatus(data.racesSelected, data.totalPlayers);
        });

        this.socket.on('all_races_selected', (data) => {
            const statusEl = document.getElementById('raceSelectionStatus');
            if (statusEl) {
                statusEl.textContent = 'Alle Rassen gewählt! Karte wird generiert...';
            }
            showNotification('Alle Rassen gewählt! Spiel wird vorbereitet...', 'success');
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
        this.gameDbId = null;
        
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

        // Initialize status
        this.updateRaceSelectionStatus();
    }

    selectRace(raceId) {
        console.log('Attempting to select race:', raceId);
        console.log('Current gameDbId:', this.gameDbId);
        console.log('Current playerName:', this.playerName);
        
        // Try to get gameDbId from multiple sources
        let gameDbId = this.gameDbId;
        
        if (!gameDbId) {
            // Try localStorage backup
            gameDbId = loadFromLocalStorage('currentDbGameId', null);
            console.log('Trying gameDbId from localStorage:', gameDbId);
        }
        
        if (!gameDbId) {
            // Try to extract from URL if we're on game page
            const urlGameId = getGameIdFromUrl();
            if (urlGameId) {
                gameDbId = urlGameId;
                console.log('Trying gameDbId from URL:', gameDbId);
            }
        }
        
        if (!gameDbId) {
            showNotification('Spiel-ID fehlt. Bitte versuche es erneut.', 'error');
            console.error('No gameDbId available for race selection');
            return;
        }
        
        if (!this.playerName) {
            showNotification('Spielername fehlt. Bitte lade die Seite neu.', 'error');
            console.error('No playerName available for race selection');
            return;
        }

        // Check if race already selected or unavailable
        const raceCard = document.querySelector(`[data-race-id="${raceId}"]`);
        if (raceCard && raceCard.classList.contains('unavailable')) {
            showNotification('Diese Rasse wurde bereits gewählt', 'warning');
            return;
        }

        // Update UI to show selection (optimistic update)
        document.querySelectorAll('.race-card').forEach(card => {
            card.classList.remove('selected');
        });
        if (raceCard) {
            raceCard.classList.add('selected');
        }

        this.selectedRaceId = raceId;

        console.log('Sending race selection:', {
            gameId: gameDbId,
            playerName: this.playerName,
            raceId: raceId
        });

        // Send selection to server
        this.socket.emit('select_race', {
            gameId: gameDbId,
            playerName: this.playerName,
            raceId: raceId
        });

        // Show selected race info
        const selectedRace = this.availableRaces.find(race => race.id === raceId);
        if (selectedRace) {
            const selectedRaceInfo = document.getElementById('selectedRaceInfo');
            if (selectedRaceInfo) {
                selectedRaceInfo.innerHTML = `
                    <h4>Gewählt: ${selectedRace.name}</h4>
                    <p>${selectedRace.description}</p>
                    <p style="color: ${selectedRace.color_hex}; font-weight: bold;">
                        Deine Farbe: ${selectedRace.color_hex}
                    </p>
                    <small>Warte auf Serverbestätigung...</small>
                `;
            }
        }

        this.updateRaceSelectionStatus();
    }

    updateRaceSelection(raceId, playerName) {
        // Mark race as unavailable for other players
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

    updateRaceSelectionStatus(racesSelected = null, totalPlayers = null) {
        const statusEl = document.getElementById('raceSelectionStatus');
        if (!statusEl) return;

        if (racesSelected !== null && totalPlayers !== null) {
            // Update with server data
            if (this.selectedRaceId) {
                statusEl.textContent = `✅ Rasse gewählt! (${racesSelected}/${totalPlayers} Spieler fertig)`;
                statusEl.style.background = '#2ecc71';
            } else {
                statusEl.textContent = `Wähle deine Rasse... (${racesSelected}/${totalPlayers} Spieler fertig)`;
                statusEl.style.background = '#3498db';
            }
        } else {
            // Update with local data only
            if (this.selectedRaceId) {
                statusEl.textContent = 'Rasse gewählt! Warte auf andere Spieler...';
                statusEl.style.background = '#f39c12'; // Orange for "waiting for confirmation"
            } else {
                statusEl.textContent = 'Wähle deine Rasse aus...';
                statusEl.style.background = '#3498db';
            }
        }
    }
}

// Initialize lobby when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.lobbyManager = new LobbyManager();
});