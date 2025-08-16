// Lobby JavaScript - Frontend logic for game lobby

class LobbyManager {
    constructor() {
        this.socket = null;
        this.currentGameId = null;
        this.playerName = '';
        this.availableRaces = [];
        this.currentPlayers = [];
        this.isReady = false;
        
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
        });

        this.socket.on('error', (error) => {
            console.error('Socket Error:', error);
            showNotification(error, 'error');
        });

        // Game events
        this.socket.on('game_created', (data) => {
            showNotification('Spiel erfolgreich erstellt!', 'success');
            this.joinGameLobby(data.gameId);
        });

        this.socket.on('game_joined', (data) => {
            showNotification('Spiel erfolgreich beigetreten!', 'success');
            this.joinGameLobby(data.gameId);
        });

        this.socket.on('games_updated', (games) => {
            this.updateGamesList(games);
        });

        this.socket.on('player_joined', (data) => {
            showNotification(`${data.playerName} ist dem Spiel beigetreten`, 'info');
            this.updateLobbyPlayerCount(data.currentPlayers);
        });

        this.socket.on('player_ready_status', (data) => {
            showNotification(`${data.playerName} ist ${data.ready ? 'bereit' : 'nicht bereit'}`, 'info');
            
            if (data.allReady) {
                showNotification('Alle Spieler bereit! Rassenwahl startet...', 'success');
            }
        });

        this.socket.on('start_race_selection', (data) => {
            hideModal('gameLobbyModal');
            this.startRaceSelection();
        });

        this.socket.on('race_selected', (data) => {
            showNotification(`${data.playerName} hat ${data.raceName} gewählt`, 'info');
            this.updateRaceSelection(data.raceId, data.playerName);
        });

        this.socket.on('game_started', (data) => {
            showNotification('Spiel startet! Weiterleitung...', 'success');
            setTimeout(() => {
                window.location.href = `/game/${this.currentGameId}`;
            }, 2000);
        });
    }

    setupEventListeners() {
        // Player name input
        const playerNameInput = document.getElementById('playerName');
        playerNameInput.addEventListener('input', debounce((e) => {
            this.playerName = e.target.value.trim();
            this.savePlayerName();
        }, 500));

        // Create game button
        document.getElementById('createGameBtn').addEventListener('click', () => {
            this.createGame();
        });

        // Refresh games button
        document.getElementById('refreshGamesBtn').addEventListener('click', () => {
            this.loadAvailableGames();
        });

        // Lobby modal buttons
        document.getElementById('readyBtn').addEventListener('click', () => {
            this.toggleReady();
        });

        document.getElementById('leaveLobbyBtn').addEventListener('click', () => {
            this.leaveLobby();
        });

        // Enter key submit
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const activeElement = document.activeElement;
                if (activeElement.id === 'playerName' || activeElement.id === 'gameName') {
                    this.createGame();
                }
            }
        });
    }

    loadPlayerName() {
        const savedName = loadFromLocalStorage('playerName', '');
        if (savedName) {
            document.getElementById('playerName').value = savedName;
            this.playerName = savedName;
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
        
        if (games.length === 0) {
            gamesList.innerHTML = '<div class="loading">Keine Spiele verfügbar</div>';
            return;
        }

        gamesList.innerHTML = games.map(game => `
            <div class="game-item" data-game-id="${game.id}" data-game-name="${game.name}" 
                 data-max-players="${game.max_players}" data-map-size="${game.map_size}">
                <h4>${game.name}</h4>
                <div class="game-details">
                    <span>Spieler: ${game.current_players}/${game.max_players}</span>
                    <span>Karte: ${game.map_size}x${game.map_size}</span>
                    <span>Status: ${this.getStatusText(game.status)}</span>
                </div>
                <div class="players-list">
                    <strong>Spieler:</strong> ${game.players.join(', ') || 'Keine'}
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

        const gameName = document.getElementById('gameName').value;
        const gameNameValidation = validateGameName(gameName);
        if (!gameNameValidation.valid) {
            showNotification(gameNameValidation.message, 'error');
            return;
        }

        const maxPlayers = parseInt(document.getElementById('maxPlayers').value);
        const mapSize = parseInt(document.getElementById('mapSize').value);

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

        this.socket.emit('join_game', {
            gameId: gameId,
            playerName: this.playerName
        });

        // Store game info for lobby
        this.currentGameId = gameId;
        this.setupLobbyModal(gameName, maxPlayers, mapSize);
    }

    setupLobbyModal(gameName, maxPlayers, mapSize) {
        document.getElementById('modalGameName').textContent = gameName;
        document.getElementById('modalMaxPlayers').textContent = maxPlayers;
        document.getElementById('modalMapSize').textContent = mapSize;
        document.getElementById('modalMapSizeY').textContent = mapSize;
        
        showModal('gameLobbyModal');
    }

    joinGameLobby(gameId) {
        this.currentGameId = gameId;
        // The modal is already shown, just update the game ID
    }

    updateLobbyPlayerCount(currentPlayers) {
        document.getElementById('modalPlayerCount').textContent = currentPlayers;
    }

    toggleReady() {
        if (!this.currentGameId) return;

        this.isReady = !this.isReady;
        
        this.socket.emit('player_ready', {
            gameId: this.currentGameId,
            playerName: this.playerName
        });

        const readyBtn = document.getElementById('readyBtn');
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

    leaveLobby() {
        hideModal('gameLobbyModal');
        this.currentGameId = null;
        this.isReady = false;
        
        // Reset ready button
        const readyBtn = document.getElementById('readyBtn');
        readyBtn.textContent = 'Bereit';
        readyBtn.classList.remove('btn-secondary');
        readyBtn.classList.add('btn-success');
        
        // Refresh games list
        this.loadAvailableGames();
    }

    startRaceSelection() {
        this.setupRaceSelectionModal();
        showModal('raceSelectionModal');
    }

    setupRaceSelectionModal() {
        const racesList = document.getElementById('racesList');
        
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
    }

    selectRace(raceId) {
        if (!this.currentGameId) return;

        // Update UI to show selection
        document.querySelectorAll('.race-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.querySelector(`[data-race-id="${raceId}"]`).classList.add('selected');

        // Send selection to server
        this.socket.emit('select_race', {
            gameId: this.currentGameId,
            playerName: this.playerName,
            raceId: raceId
        });

        // Show selected race info
        const selectedRace = this.availableRaces.find(race => race.id === raceId);
        if (selectedRace) {
            document.getElementById('selectedRaceInfo').innerHTML = `
                <h4>Gewählt: ${selectedRace.name}</h4>
                <p>${selectedRace.description}</p>
                <p style="color: ${selectedRace.color_hex}; font-weight: bold;">
                    Deine Farbe: ${selectedRace.color_hex}
                </p>
            `;
        }
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
}

// Initialize lobby when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.lobbyManager = new LobbyManager();
});