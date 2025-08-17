// Lobby JavaScript - Frontend logic with improved connection handling and chat

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
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.heartbeatInterval = null;
        this.chatManager = null; // Chat system
        
        this.init();
    }

    init() {
        this.setupSocket();
        this.setupEventListeners();
        this.loadPlayerName();
        this.loadAvailableGames();
        this.loadRaces();
        this.startHeartbeat();
        this.initializeChat();
    }

    // Initialize chat system
    initializeChat() {
        if (window.ChatManager && !this.chatManager) {
            this.chatManager = new window.ChatManager();
            console.log('Chat manager created');
        }
    }
	
    // Chat für normale Spiellobby initialisieren
    initializeLobbyChat() {
        console.log('Initializing lobby chat...');
        
        if (!this.chatManager) {
            console.warn('ChatManager not available for lobby chat');
            return false;
        }
        
        if (!this.currentGameId || !this.playerName) {
            console.warn('Missing gameId or playerName for lobby chat');
            return false;
        }
        
        // Verwende Memory Game ID für Lobby Chat
        const chatInitialized = this.chatManager.init(this.socket, this.currentGameId, this.playerName);
        
        if (chatInitialized) {
            console.log('Lobby chat initialized successfully');
            
            // Chat-Container anzeigen
            const lobbyChatElement = document.getElementById('lobbyChat');
            if (lobbyChatElement) {
                lobbyChatElement.style.display = 'block';
                console.log('Lobby chat element shown');
                
                // Setup character counter für Lobby Chat
                this.setupLobbyChatCharacterCounter();
                
                // Join chat room on server
                this.socket.emit('join_chat_room', {
                    gameId: this.currentGameId, // Memory Game ID für Lobby
                    playerName: this.playerName
                });
                
                console.log(`Joined lobby chat room: ${this.currentGameId}`);
                return true;
            } else {
                console.error('Lobby chat element not found in DOM');
            }
        } else {
            console.error('Failed to initialize lobby chat');
        }
        
        return false;
    }

    // Setup character counter für Lobby Chat Input
    setupLobbyChatCharacterCounter() {
        const lobbyChatInput = document.getElementById('lobbyChatMessageInput');
        const lobbyCharCount = document.getElementById('lobbyChatCharCount');
        
        if (lobbyChatInput && lobbyCharCount) {
            lobbyChatInput.addEventListener('input', () => {
                const currentLength = lobbyChatInput.value.length;
                const maxLength = 500;
                
                lobbyCharCount.textContent = currentLength;
                
                // Update character counter styling
                lobbyCharCount.className = 'char-count';
                if (currentLength > maxLength * 0.8) {
                    lobbyCharCount.classList.add('warning');
                }
                if (currentLength > maxLength * 0.95) {
                    lobbyCharCount.classList.remove('warning');
                    lobbyCharCount.classList.add('danger');
                }
            });
            
            console.log('Lobby chat character counter setup complete');
        } else {
            console.warn('Lobby chat input or character counter not found');
        }
    }

    // Chat für Lobby deaktivieren
    deactivateLobbyChat() {
        console.log('Deactivating lobby chat...');
        
        if (this.chatManager && this.currentGameId && this.playerName) {
            // Leave chat room on server
            this.socket.emit('leave_chat_room', {
                gameId: this.currentGameId,
                playerName: this.playerName
            });
        }
        
        // Hide chat element
        const lobbyChatElement = document.getElementById('lobbyChat');
        if (lobbyChatElement) {
            lobbyChatElement.style.display = 'none';
        }
        
        console.log('Lobby chat deactivated');
    }

    // Setup character counter for chat input
    setupChatCharacterCounter() {
        const chatInput = document.getElementById('chatMessageInput');
        const charCount = document.getElementById('chatCharCount');
        
        if (chatInput && charCount) {
            chatInput.addEventListener('input', () => {
                const currentLength = chatInput.value.length;
                const maxLength = 500;
                
                charCount.textContent = currentLength;
                
                // Update character counter styling
                charCount.className = '';
                if (currentLength > maxLength * 0.8) {
                    charCount.classList.add('warning');
                }
                if (currentLength > maxLength * 0.95) {
                    charCount.classList.remove('warning');
                    charCount.classList.add('danger');
                }
            });
        }
    }
	
handleIncomingChatMessage(data) {
        if (!data || !data.playerName || !data.message) {
            console.warn('Invalid chat message data:', data);
            return;
        }
        
        // Füge Nachricht zu beiden Chat-Containern hinzu
        this.addChatMessageToContainer('lobbyChatMessages', data);
        this.addChatMessageToContainer('chatMessages', data);
    }

    // NEUE Methode: Chat-Nachricht zu Container hinzufügen
    addChatMessageToContainer(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const messageElement = this.createChatMessageElement(data);
        container.appendChild(messageElement);
        
        // Auto-scroll
        container.scrollTop = container.scrollHeight;
    }

    // NEUE Methode: Chat-Nachricht Element erstellen
    createChatMessageElement(data) {
        const messageElement = document.createElement('div');
        const isOwnMessage = data.playerName === this.playerName;
        
        messageElement.className = `chat-message ${isOwnMessage ? 'own-message' : 'other-message'}`;
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="player-name">${this.escapeHtml(data.playerName)}</span>
                <span class="message-time">${this.formatTime(data.timestamp)}</span>
            </div>
            <div class="message-content">
                ${this.formatChatMessage(data.message)}
            </div>
        `;
        
        return messageElement;
    }

    // NEUE Methode: System-Nachricht hinzufügen
    addSystemChatMessage(message) {
        ['lobbyChatMessages', 'chatMessages'].forEach(containerId => {
            const container = document.getElementById(containerId);
            if (container) {
                const messageElement = document.createElement('div');
                messageElement.className = 'chat-message system-message';
                messageElement.innerHTML = `
                    <div class="message-content">
                        <span class="system-text">${this.escapeHtml(message)}</span>
                        <span class="message-time">${this.formatTime(Date.now())}</span>
                    </div>
                `;
                container.appendChild(messageElement);
                container.scrollTop = container.scrollHeight;
            }
        });
    }

    // NEUE Methode: Player Count aktualisieren
    updateChatPlayerCount(count) {
        ['lobbyChatPlayerCount', 'chatPlayerCount'].forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = count;
            }
        });
    }

    // NEUE Hilfsmethoden
    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatChatMessage(message) {
        return this.escapeHtml(message)
            .replace(/\n/g, '<br>')
            .replace(/:\)/g, '😊')
            .replace(/:\(/g, '😞')
            .replace(/:D/g, '😃')
            .replace(/;\)/g, '😉')
            .replace(/:P/g, '😛');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setupSocket() {
        // Enhanced Socket.IO configuration with better reconnection
        this.socket = io({
            transports: ['websocket', 'polling'],
            upgrade: true,
            rememberUpgrade: true,
            timeout: 20000,
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            maxReconnectionAttempts: this.maxReconnectAttempts,
            forceNew: false
        });
        
        this.socket.on('connect', () => {
            console.log('Verbunden mit Server');
            this.reconnectAttempts = 0;
            showNotification('Mit Server verbunden', 'success');
            
            // Rejoin game room if we were in one
            this.rejoinGameRoom();
        });

        this.socket.on('disconnect', (reason) => {
            console.log('Verbindung zum Server verloren:', reason);
            showNotification('Verbindung zum Server verloren - Versuche Reconnection...', 'warning');
            
            if (reason === 'io server disconnect') {
                // Server disconnected us, reconnect manually
                this.socket.connect();
            }
        });

        this.socket.on('reconnect', (attemptNumber) => {
            console.log('Reconnected after', attemptNumber, 'attempts');
            showNotification('Verbindung wiederhergestellt!', 'success');
            this.rejoinGameRoom();
        });

        this.socket.on('reconnect_attempt', (attemptNumber) => {
            console.log('Reconnection attempt:', attemptNumber);
            if (attemptNumber <= 3) {
                showNotification(`Verbindungsversuch ${attemptNumber}...`, 'info');
            }
        });

        this.socket.on('reconnect_failed', () => {
            console.log('Failed to reconnect');
            showNotification('Verbindung konnte nicht wiederhergestellt werden. Bitte lade die Seite neu.', 'error');
        });

        this.socket.on('error', (error) => {
            console.error('Socket Error:', error);
            showNotification('Verbindungsfehler: ' + error, 'error');
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
            saveToLocalStorage('playerName', this.playerName);
            
            showNotification(`Spiel in Datenbank erstellt (ID: ${data.dbGameId})`, 'info');
        });

        this.socket.on('start_race_selection', (data) => {
            console.log('Starting race selection with data:', data);
            
            // Ensure we have the correct DB game ID
            if (data.dbGameId) {
                this.gameDbId = data.dbGameId;
                saveToLocalStorage('currentDbGameId', this.gameDbId);
                saveToLocalStorage('playerName', this.playerName);
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
            saveToLocalStorage('playerName', this.playerName);
            
            // If race selection modal is already open, update the ID
            if (document.getElementById('raceSelectionModal').style.display === 'block') {
                showNotification(`Spiel-ID erhalten: ${data.dbGameId}`, 'info');
            }
        });

        // *** CHAT EVENTS - WICHTIG FÜR CHAT FUNKTIONALITÄT ***
        this.socket.on('chat_message', (data) => {
            console.log('Received chat message:', data);
            this.handleIncomingChatMessage(data);
        });

        this.socket.on('chat_player_joined', (data) => {
            this.addSystemChatMessage(`${data.playerName} ist dem Chat beigetreten`);
            this.updateChatPlayerCount(data.playerCount);
        });

        this.socket.on('chat_player_left', (data) => {
            this.addSystemChatMessage(`${data.playerName} hat den Chat verlassen`);
            this.updateChatPlayerCount(data.playerCount);
        });

        this.socket.on('chat_player_count', (data) => {
            this.updateChatPlayerCount(data.count);
        });

        this.socket.on('chat_history', (data) => {
            console.log('Received chat history:', data);
            this.loadChatHistory(data.messages);
        });

        // Race selection events
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
            console.log('Player race selected event:', data);
            
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
            
            // Immediately update both displays for live feedback
            this.updatePlayersRaceStatus();
            this.updateRaceCardsDisplay();
        });

        this.socket.on('player_race_confirmed', (data) => {
            console.log('Player race confirmed event:', data);
            
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
            
            // Immediately update displays
            this.updatePlayersRaceStatus();
            this.updateRaceCardsDisplay();
            this.updateRaceSelectionStatus(data.confirmedCount, data.totalPlayers);
        });

        this.socket.on('player_race_deselected', (data) => {
            console.log('Player race deselected event:', data);
            
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
            
            // Immediately update displays
            this.updatePlayersRaceStatus();
            this.updateRaceCardsDisplay();
        });

        this.socket.on('race_deselection_confirmed', (data) => {
            console.log('Race deselection confirmed:', data.message);
            // Don't show notification here as it's already shown in changeRaceSelection()
        });

        // NEW: Race selection sync event
        this.socket.on('race_selection_sync', (data) => {
            console.log('Received race selection sync:', data);
            
            // Update all players race status from server
            this.playersRaceStatus.clear();
            if (data.selections) {
                data.selections.forEach(selection => {
                    this.playersRaceStatus.set(selection.player_name, {
                        playerName: selection.player_name,
                        selectedRaceId: selection.race_id,
                        confirmed: selection.race_confirmed,
                        raceName: selection.race_name
                    });
                    
                    // Update own status if this is our player
                    if (selection.player_name === this.playerName) {
                        this.selectedRaceId = selection.race_id;
                        this.raceConfirmed = selection.race_confirmed;
                    }
                });
            }
            
            // Refresh all displays
            this.updatePlayersRaceStatus();
            this.updateRaceCardsDisplay();
            this.updateRaceSelectionButtons();
            this.updateRaceSelectionStatus();
        });

        this.socket.on('game_started', (data) => {
            showNotification('Spiel startet! Weiterleitung...', 'success');
            
            // Cleanup chat before leaving
            if (this.chatManager) {
                // Leave chat room on server
                if (this.gameDbId && this.playerName) {
                    this.socket.emit('leave_chat_room', {
                        gameId: this.gameDbId,
                        playerName: this.playerName
                    });
                }
                this.chatManager.destroy();
                this.chatManager = null;
            }
            
            // Make modal closeable again and hide it
            makeModalCloseable('raceSelectionModal');
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

        // NEW: Heartbeat response
        this.socket.on('heartbeat_response', () => {
            // Server is alive, connection is good
            console.log('Heartbeat OK');
        });
    }

    // NEUE Methode: Chat-Verlauf laden
    loadChatHistory(messages) {
        if (!messages || !Array.isArray(messages)) return;
        
        console.log(`Loading chat history: ${messages.length} messages`);
        
        // Lade Nachrichten in beide Chat-Container
        ['lobbyChatMessages', 'chatMessages'].forEach(containerId => {
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = ''; // Clear existing
                
                messages.forEach(msg => {
                    this.addChatMessageToContainer(containerId, {
                        playerName: msg.playerName,
                        message: msg.message,
                        timestamp: msg.timestamp,
                        playerId: msg.playerId
                    });
                });
            }
        });
        
        this.addSystemChatMessage('Chat-Verlauf geladen');
    }

    // NEW: Start heartbeat to keep connection alive
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.socket && this.socket.connected) {
                this.socket.emit('heartbeat', {
                    playerName: this.playerName,
                    gameDbId: this.gameDbId,
                    timestamp: Date.now()
                });
            }
        }, 30000); // Every 30 seconds
    }

    // NEW: Rejoin game room after reconnection
    rejoinGameRoom() {
        // Try to restore state from localStorage
        const savedGameDbId = loadFromLocalStorage('currentDbGameId', null);
        const savedPlayerName = loadFromLocalStorage('playerName', '');
        
        if (savedGameDbId && savedPlayerName) {
            this.gameDbId = savedGameDbId;
            this.playerName = savedPlayerName;
            
            console.log('Rejoining game room:', savedGameDbId, 'as', savedPlayerName);
            
            // Rejoin the database game room
            this.socket.emit('rejoin_db_game_room', {
                gameId: savedGameDbId,
                playerName: savedPlayerName
            });
            
            // Request current race selection status
            this.socket.emit('request_race_selection_sync', {
                gameId: savedGameDbId,
                playerName: savedPlayerName
            });
            
            // Rejoin chat room if race selection modal is open
            const raceModal = document.getElementById('raceSelectionModal');
            if (raceModal && raceModal.style.display === 'block') {
                this.socket.emit('join_chat_room', {
                    gameId: savedGameDbId,
                    playerName: savedPlayerName
                });
                
                // Reinitialize chat if needed
                if (!this.chatManager) {
                    this.initializeChat();
                    if (this.chatManager) {
                        this.chatManager.init(this.socket, savedGameDbId, savedPlayerName);
                        this.setupChatCharacterCounter();
                    }
                }
            }
        }
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

        // Handle page visibility changes (mobile/background tabs)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.socket && !this.socket.connected) {
                console.log('Page became visible, attempting reconnection...');
                this.socket.connect();
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
        
        // *** NEUE CHAT-INITIALISIERUNG ***
        // Chat für normale Lobby initialisieren (mit Memory Game ID)
        setTimeout(() => {
            this.initializeLobbyChat();
        }, 500); // Kurze Verzögerung um sicherzustellen dass DOM bereit ist
    }

    // Hide current game lobby
    hideCurrentGameLobby() {
        const currentGameSection = document.getElementById('currentGameSection');
        if (currentGameSection) {
            currentGameSection.style.display = 'none';
        }
        
        // *** CHAT DEAKTIVIEREN ***
        this.deactivateLobbyChat();
        
        this.currentGameId = null;
        this.isReady = false;
        this.isHost = false;
        this.selectedRaceId = null;
        this.raceConfirmed = false;
        this.gameDbId = null;
        this.playersRaceStatus.clear();
        
        // Clear localStorage
        saveToLocalStorage('currentDbGameId', null);
        saveToLocalStorage('currentGameId', null);
        
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

    // UPDATED: startRaceSelection Methode - Chat weiterführen statt neu initialisieren
    startRaceSelection() {
        console.log('Starting race selection modal');
        console.log('Available races:', this.availableRaces.length);
        console.log('Current gameDbId:', this.gameDbId);
        console.log('Current playerName:', this.playerName);
        
        this.setupRaceSelectionModal();
        showModal('raceSelectionModal');
        
        // Make the race selection modal persistent (cannot be closed by clicking outside or ESC)
        makeModalPersistent('raceSelectionModal');
        
        // *** CHAT FIX: Chat für Race Selection übertragen ***
        this.transferChatToRaceSelection();
    }

    // NEUE Methode: Chat von Lobby zu Race Selection übertragen
    transferChatToRaceSelection() {
        console.log('Transferring chat to race selection...');
        
        if (!this.chatManager || !this.chatManager.isInitialized) {
            console.warn('Chat not initialized in lobby, initializing for race selection...');
            this.initializeRaceSelectionChat();
            return;
        }
        
        // Deaktiviere Lobby-Chat visuell (aber behalte Verbindung)
        const lobbyChatElement = document.getElementById('lobbyChat');
        if (lobbyChatElement) {
            lobbyChatElement.style.display = 'none';
        }
        
        // Aktiviere Race Selection Chat mit demselben ChatManager
        const raceSelectionChatElement = document.getElementById('raceSelectionChat');
        if (raceSelectionChatElement) {
            raceSelectionChatElement.style.display = 'block';
            
            // Setup Race Selection Chat Elements für bestehenden ChatManager
            this.setupRaceSelectionChatElements();
            
            // Transfer Chat-Nachrichten
            this.transferChatMessages();
            
            console.log('Chat successfully transferred to race selection');
        } else {
            console.error('Race selection chat element not found');
        }
    }

    // NEUE Methode: Race Selection Chat initialisieren (falls kein Lobby-Chat existiert)
    initializeRaceSelectionChat() {
        console.log('Initializing race selection chat...');
        
        if (!this.chatManager) {
            this.chatManager = new window.ChatManager();
        }
        
        // Verwende DB Game ID für Race Selection Chat
        const gameId = this.gameDbId || this.currentGameId;
        if (!gameId || !this.playerName) {
            console.error('Missing gameDbId or playerName for race selection chat');
            return;
        }
        
        // Chat mit Race Selection Kontext initialisieren
        const chatInitialized = this.chatManager.init(this.socket, gameId, this.playerName);
        
        if (chatInitialized) {
            // Setup für Race Selection
            this.setupRaceSelectionChatElements();
            
            // Join chat room
            this.socket.emit('join_chat_room', {
                gameId: gameId,
                playerName: this.playerName
            });
            
            console.log('Race selection chat initialized successfully');
        }
    }

    // NEUE Methode: Race Selection Chat Elements setup
    setupRaceSelectionChatElements() {
        const raceSelectionChat = document.getElementById('raceSelectionChat');
        if (!raceSelectionChat) {
            console.error('Race selection chat container not found');
            return;
        }
        
        // Zeige Chat-Container
        raceSelectionChat.style.display = 'block';
        
        // Update ChatManager mit Race Selection Elements
        this.chatManager.chatContainer = raceSelectionChat;
        this.chatManager.messagesContainer = document.getElementById('chatMessages');
        this.chatManager.messageInput = document.getElementById('chatMessageInput');
        this.chatManager.sendButton = document.getElementById('chatSendButton');
        this.chatManager.playerCountElement = document.getElementById('chatPlayerCount');
        
        // Setup Event Listeners für Race Selection Chat
        this.setupRaceSelectionChatEventListeners();
        
        // Setup Character Counter für Race Selection
        this.setupRaceSelectionChatCharacterCounter();
        
        console.log('Race selection chat elements setup complete');
    }

    // NEUE Methode: Event Listeners für Race Selection Chat
    setupRaceSelectionChatEventListeners() {
        const messageInput = document.getElementById('chatMessageInput');
        const sendButton = document.getElementById('chatSendButton');
        
        if (!messageInput || !sendButton) {
            console.error('Race selection chat input elements not found');
            return;
        }
        
        // Remove existing listeners
        messageInput.removeEventListener('keypress', this.raceSelectionKeypressHandler);
        sendButton.removeEventListener('click', this.raceSelectionClickHandler);
        messageInput.removeEventListener('input', this.raceSelectionInputHandler);
        
        // Create bound handlers
        this.raceSelectionKeypressHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        };
        
        this.raceSelectionClickHandler = () => {
            this.sendChatMessage();
        };
        
        this.raceSelectionInputHandler = () => {
            this.updateCharacterCounter();
            this.adjustTextareaHeight(messageInput);
        };
        
        // Add event listeners
        messageInput.addEventListener('keypress', this.raceSelectionKeypressHandler);
        sendButton.addEventListener('click', this.raceSelectionClickHandler);
        messageInput.addEventListener('input', this.raceSelectionInputHandler);
        
        console.log('Race selection chat event listeners setup complete');
    }

    // NEUE Methode: Character Counter für Race Selection
    setupRaceSelectionChatCharacterCounter() {
        const messageInput = document.getElementById('chatMessageInput');
        const charCount = document.getElementById('chatCharCount');
        
        if (messageInput && charCount) {
            // Initial update
            this.updateCharacterCounter();
            console.log('Race selection character counter setup complete');
        }
    }

    // NEUE Methode: Chat-Nachrichten von Lobby zu Race Selection übertragen
    transferChatMessages() {
        const lobbyChatMessages = document.getElementById('lobbyChatMessages');
        const raceSelectionChatMessages = document.getElementById('chatMessages');
        
        if (lobbyChatMessages && raceSelectionChatMessages) {
            // Kopiere alle Nachrichten
            raceSelectionChatMessages.innerHTML = lobbyChatMessages.innerHTML;
            
            // Scroll to bottom
            raceSelectionChatMessages.scrollTop = raceSelectionChatMessages.scrollHeight;
            
            console.log('Chat messages transferred to race selection');
        }
    }

    // NEUE Methode: Chat-Nachricht senden (funktioniert für beide Kontexte)
    sendChatMessage() {
        console.log('Sending chat message...');
        
        // Bestimme aktuellen Chat-Input
        let messageInput;
        let gameId;
        
        // Prüfe welcher Chat aktiv ist
        const raceModal = document.getElementById('raceSelectionModal');
        const isRaceModalOpen = raceModal && raceModal.style.display === 'block';
        
        if (isRaceModalOpen) {
            // Race Selection Chat
            messageInput = document.getElementById('chatMessageInput');
            gameId = this.gameDbId || this.currentGameId;
        } else {
            // Lobby Chat
            messageInput = document.getElementById('lobbyChatMessageInput');
            gameId = this.currentGameId;
        }
        
        if (!messageInput) {
            console.error('Chat input not found');
            return;
        }
        
        const message = messageInput.value.trim();
        if (!message) {
            console.warn('Empty message, not sending');
            return;
        }
        
        if (message.length > 500) {
            showNotification('Nachricht ist zu lang (max. 500 Zeichen)', 'error');
            return;
        }
        
        if (!gameId || !this.playerName) {
            console.error('Missing gameId or playerName for chat message');
            showNotification('Fehler: Spiel-ID oder Spielername fehlt', 'error');
            return;
        }
        
        console.log('Sending message:', { gameId, playerName: this.playerName, message });
        
        // Send message to server
        this.socket.emit('send_chat_message', {
            gameId: gameId,
            playerName: this.playerName,
            message: message,
            timestamp: Date.now()
        });
        
        // Clear input
        messageInput.value = '';
        this.updateCharacterCounter();
        this.adjustTextareaHeight(messageInput);
        messageInput.focus();
        
        console.log('Chat message sent successfully');
    }

    // NEUE Methode: Character Counter aktualisieren
    updateCharacterCounter() {
        // Bestimme aktuellen Kontext
        const raceModal = document.getElementById('raceSelectionModal');
        const isRaceModalOpen = raceModal && raceModal.style.display === 'block';
        
        let messageInput, charCount;
        
        if (isRaceModalOpen) {
            messageInput = document.getElementById('chatMessageInput');
            charCount = document.getElementById('chatCharCount');
        } else {
            messageInput = document.getElementById('lobbyChatMessageInput');
            charCount = document.getElementById('lobbyChatCharCount');
        }
        
        if (messageInput && charCount) {
            const currentLength = messageInput.value.length;
            const maxLength = 500;
            
            charCount.textContent = currentLength;
            
            // Update styling
            charCount.className = 'char-count';
            if (currentLength > maxLength * 0.8) {
                charCount.classList.add('warning');
            }
            if (currentLength > maxLength * 0.95) {
                charCount.classList.remove('warning');
                charCount.classList.add('danger');
            }
        }
    }

    // NEUE Methode: Textarea-Höhe anpassen
    adjustTextareaHeight(textarea) {
        if (!textarea) return;
        
        textarea.style.height = 'auto';
        const newHeight = Math.min(textarea.scrollHeight, 100); // Max 100px
        textarea.style.height = newHeight + 'px';
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

        // Allow selection of any race - multiple players can choose the same race

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
        console.log('Updating race cards display');
        
        // Reset all race cards but keep click functionality
        document.querySelectorAll('.race-card').forEach(card => {
            // Remove ALL old indicators (including taken-indicators)
            const indicators = card.querySelectorAll('.race-players-indicator, .taken-indicator, .confirmed-indicator');
            indicators.forEach(indicator => indicator.remove());
            
            // Reset classes but keep base functionality
            const raceId = parseInt(card.dataset.raceId);
            card.className = 'race-card';
            
            // Restore own selection state if applicable
            if (this.selectedRaceId === raceId) {
                if (this.raceConfirmed) {
                    card.classList.add('own-confirmed');
                } else {
                    card.classList.add('own-selection');
                }
            }
            
            // Ensure card is always clickable
            card.style.pointerEvents = '';
            card.style.position = 'relative'; // Needed for positioning indicators
        });

        // Group players by race for display
        const raceGroups = new Map();
        this.playersRaceStatus.forEach((status, playerName) => {
            if (status.selectedRaceId) {
                if (!raceGroups.has(status.selectedRaceId)) {
                    raceGroups.set(status.selectedRaceId, []);
                }
                raceGroups.get(status.selectedRaceId).push(status);
            }
        });

        // Add ONLY the new bottom indicators for each race that has players
        raceGroups.forEach((players, raceId) => {
            const raceCard = document.querySelector(`[data-race-id="${raceId}"]`);
            if (raceCard) {
                // Create players indicator (ONLY at bottom)
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
                    line-height: 1.2;
                `;
                
                raceCard.appendChild(indicator);
                
                // Add visual styling based on selection status
                if (confirmedPlayers.length > 0) {
                    raceCard.classList.add('has-confirmed-players');
                }
                if (unconfirmedPlayers.length > 0) {
                    raceCard.classList.add('has-selecting-players');
                }
            }
        });
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
        
        // Send confirmation to server (this will write to database)
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
        
        // Complete reset and rebuild of race cards display
        this.resetAllRaceCards();
        this.updateRaceCardsDisplay();
        
        const selectedRaceInfo = document.getElementById('selectedRaceInfo');
        if (selectedRaceInfo) {
            selectedRaceInfo.innerHTML = '<p>Wähle eine neue Rasse aus der Liste oben.</p>';
        }
        
        this.updateRaceSelectionButtons();
        this.updateRaceSelectionStatus();
        this.updatePlayersRaceStatus();
        
        // Now notify server about deselection (this will remove from database)
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
            showNotification('Spiel-ID fehlt. Bitte lade die Seite neu.', 'error');
            return;
        }
        
        if (!this.playerName) {
            console.warn('No playerName available for race deselection');
            showNotification('Spielername fehlt. Bitte lade die Seite neu.', 'error');
            return;
        }

        console.log('Sending race deselection (removing from database):', {
            gameId: gameDbId,
            playerName: this.playerName
        });

        // Send deselection to server (will remove race_id and set race_confirmed to false in database)
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

        // Send selection to server (will write to database if confirmed)
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

    // Cleanup on page unload
    destroy() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        // Cleanup chat
        if (this.chatManager) {
            // Leave chat room on server
            if (this.gameDbId && this.playerName) {
                this.socket.emit('leave_chat_room', {
                    gameId: this.gameDbId,
                    playerName: this.playerName
                });
            }
            this.chatManager.destroy();
            this.chatManager = null;
        }
        
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}

// Initialize lobby when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.lobbyManager = new LobbyManager();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.lobbyManager) {
        window.lobbyManager.destroy();
    }
});