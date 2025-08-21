// Lobby JavaScript - Frontend logic with improved connection handling and chat

class StrategyGameClient {
    constructor() {
        this.socket = null;
        this.currentGameId = null; // Memory ID
        this.gameDbId = null; // NEUE: Database ID				  
        this.gameState = null;
        this.playerName = '';
        this.availableRaces = [];
        this.currentPlayers = [];
        this.isReady = false;
        this.isHost = false;
        this.selectedRace = null;
        this.gameDbId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.connectionStatus = null;
        this.chatInitialized = false;
        this.currentChatContext = 'lobby';
        
        this.init();
    }

init() {
    this.initializeSocket();
    this.setupEventListeners();
    this.setupLayoutEventListeners();
    this.loadAvailableGames();
    this.initializeChat();
    
    window.gameClient = this;  // ← DIESE ZEILE HINZUFÜGEN
    
    console.log('Strategy game client initialized with improved ID handling');
}

    // Socket-Verbindung initialisieren
    initializeSocket() {
        if (this.socket) {
            this.socket.disconnect();
        }

        this.socket = io();
        this.connectionStatus = document.getElementById('connectionStatus');
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            if (this.connectionStatus) {
                this.connectionStatus.textContent = 'Verbunden';
                this.connectionStatus.className = 'status connected';
            }
            this.reconnectAttempts = 0;
            this.setupChatEventListeners();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            if (this.connectionStatus) {
                this.connectionStatus.textContent = 'Getrennt';
                this.connectionStatus.className = 'status disconnected';
            }
        });

        this.socket.on('reconnect', () => {
            console.log('Reconnected to server');
            showNotification('Verbindung wiederhergestellt!', 'success');
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
            this.gameDbId = data.gameDbId; // NEUE: Speichere DB-ID
            this.showGameLobby(data);
        });

        this.socket.on('game_joined', (data) => {
            showNotification('Spiel erfolgreich beigetreten!', 'success');
            this.isHost = data.isHost;
            this.currentGameId = data.gameId;
            this.gameDbId = data.gameDbId; // NEUE: Speichere DB-ID
            this.showGameLobby(data);
        });

        this.socket.on('games_updated', (games) => {
            console.log('Games list updated:', games);
            this.updateGamesList(games);
        });
		
		this.socket.on('game_info_updated', (data) => {
            console.log('Game info updated:', data);
            this.updateGameInfo(data);
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
            this.hideGameLobby();
        });

        this.socket.on('lobby_players_updated', (players) => {
            console.log('Lobby players updated:', players);
            this.updateGamePlayersList(players);
            this.updatePlayerCounts(players);
        });

        this.socket.on('player_ready_status', (data) => {
            console.log('Player ready status updated:', data);
            this.updateReadyStatus(data);
            this.updatePlayerCounts(data.players);
        });

        this.socket.on('player_ready_notification', (data) => {
            showNotification(`${data.playerName} ist ${data.ready ? 'bereit' : 'nicht bereit'}`, 'info');
        });

        this.socket.on('game_started', (data) => {
            console.log('Game started event received:', data);
            showNotification('Das Spiel startet!', 'success');
            this.gameDbId = data.gameDbId;
            this.showRaceSelection();
        });

        this.socket.on('race-selection-joined', (data) => {
            console.log('Race selection joined:', data);
            this.gameDbId = data.gameDbId;
        });

        this.socket.on('available-races', (races) => {
            console.log('Available races received:', races);
            this.availableRaces = races;
            this.displayRaces();
        });

        this.socket.on('race-selected', (data) => {
            console.log('Race selected:', data);
            showNotification(`Rasse ${data.raceName} ausgewählt`, 'success');
            this.selectedRace = data.raceId;
            this.updateRaceSelectionUI();
        });

        this.socket.on('race-confirmed', (data) => {
            console.log('Race confirmed:', data);
            showNotification(`Rasse ${data.raceName} bestätigt!`, 'success');
            this.updateRaceSelectionUI();
        });

        this.socket.on('race-selection-update', (data) => {
            console.log('Race selection update:', data);
            this.updateRaceSelectionDisplay(data);
        });

        this.socket.on('all-races-confirmed', (data) => {
            console.log('All races confirmed:', data);
            showNotification(data.message, 'success');
            // TODO: Weiterleitung zur Karte
        });
    }

    // Event Listeners einrichten
    setupEventListeners() {
        // Spielername Event Listener
        const playerNameInput = document.getElementById('playerNameInput');
        if (playerNameInput) {
            playerNameInput.addEventListener('input', (e) => {
                this.playerName = e.target.value.trim();
                this.updateUIState();
            });
        }

        // Game creation
        const createGameBtn = document.getElementById('createGameBtn');
        if (createGameBtn) {
            createGameBtn.addEventListener('click', () => this.createGameDirectly());
        }

        // Game lobby - HIER WAR DER FEHLER: leaveLobbyBtn fehlte!
        const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
        if (leaveLobbyBtn) {
            leaveLobbyBtn.addEventListener('click', () => this.leaveCurrentGame());
            console.log('✅ Leave lobby button event listener registered');
        } else {
            console.warn('❌ leaveLobbyBtn element not found');
        }

        // Andere Lobby-Buttons
        const leaveGameBtn = document.getElementById('leaveGameBtn');
        if (leaveGameBtn) {
            leaveGameBtn.addEventListener('click', () => this.leaveCurrentGame());
        }

        const readyBtn = document.getElementById('readyBtn');
        if (readyBtn) {
            readyBtn.addEventListener('click', () => this.toggleReady());
        }

        const startGameBtn = document.getElementById('startGameBtn');
        if (startGameBtn) {
            startGameBtn.addEventListener('click', () => this.startGame());
        }

        // Race selection
        const confirmRaceBtn = document.getElementById('confirmRaceBtn');
        if (confirmRaceBtn) {
            confirmRaceBtn.addEventListener('click', () => this.confirmRaceSelection());
        }

        // LOBBY CHAT Event Listeners
        this.setupLobbyChatListeners();

        console.log('Event listeners setup complete');
    }

    // Lobby Chat Listeners einrichten
    setupLobbyChatListeners() {
        const lobbyChatInput = document.getElementById('lobbyChatMessageInput');
        const lobbyChatSendButton = document.getElementById('lobbyChatSendButton');

        if (lobbyChatInput && lobbyChatSendButton) {
            console.log('Setting up lobby chat event listeners');

            // Character counter
            lobbyChatInput.addEventListener('input', () => {
                this.updateCharacterCounter('lobby');
                this.adjustTextareaHeight(lobbyChatInput);
            });

            // Send button
            lobbyChatSendButton.addEventListener('click', () => {
                this.sendChatMessage('lobby');
            });

            // Enter key
            lobbyChatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage('lobby');
                }
            });

            // Initial character count
            const lobbyChatCharCount = document.getElementById('lobbyChatCharCount');
            if (lobbyChatCharCount) {
                lobbyChatCharCount.textContent = '0';
            }
        }
    }

    // Race Selection Chat Listeners einrichten
    setupRaceSelectionChatListeners() {
        const raceSelectionChatInput = document.getElementById('chatMessageInput');
        const raceSelectionChatSendButton = document.getElementById('chatSendButton');

        if (raceSelectionChatInput && raceSelectionChatSendButton && !raceSelectionChatInput.hasAttribute('data-listeners-setup')) {
            console.log('Setting up race selection chat event listeners');

            raceSelectionChatInput.setAttribute('data-listeners-setup', 'true');

            // Character counter
            raceSelectionChatInput.addEventListener('input', () => {
                this.updateCharacterCounter('race_selection');
                this.adjustTextareaHeight(raceSelectionChatInput);
            });

            // Send button
            raceSelectionChatSendButton.addEventListener('click', () => {
                this.sendChatMessage('race_selection');
            });

            // Enter key
            raceSelectionChatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage('race_selection');
                }
            });

            // Initial character count
            const raceSelectionCharCount = document.getElementById('chatCharCount');
            if (raceSelectionCharCount) {
                raceSelectionCharCount.textContent = '0';
            }
        }
    }

    // Chat initialisieren
    initializeChat() {
        console.log('Initializing chat system...');
        
        const lobbyChatInput = document.getElementById('lobbyChatMessageInput');
        const lobbyChatMessages = document.getElementById('lobbyChatMessages');
        
        if (lobbyChatInput && lobbyChatMessages) {
            console.log('Lobby chat elements found');
            this.chatInitialized = true;
            
            const lobbyChatCharCount = document.getElementById('lobbyChatCharCount');
            if (lobbyChatCharCount) {
                lobbyChatCharCount.textContent = '0';
            }
        }
        
        console.log('Chat system initialized');
    }

    // Chat Socket Events einrichten
    setupChatEventListeners() {
        if (!this.socket) {
            console.error('Socket not available for chat setup');
            return;
        }

        console.log('Setting up chat socket event listeners');

        this.socket.on('chat_message', (data) => {
            console.log('📨 Chat message received:', data);
            this.displayChatMessage(data);
        });

        this.socket.on('chat_history', (data) => {
            console.log('📜 Chat history received:', data);
            if (data.messages && Array.isArray(data.messages)) {
                this.clearChatMessages();
                data.messages.forEach((message, index) => {
                    setTimeout(() => {
                        this.displayChatMessage(message, index === data.messages.length - 1);
                    }, index * 50);
                });
            }
        });

        this.socket.on('chat_player_joined', (data) => {
            console.log('👋 Player joined chat:', data);
            this.addSystemMessage(`${data.playerName} ist dem Chat beigetreten`);
        });

        this.socket.on('chat_player_left', (data) => {
            console.log('👋 Player left chat:', data);
            this.addSystemMessage(`${data.playerName} hat den Chat verlassen`);
        });

        this.socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
            showNotification(`Fehler: ${error}`, 'error');
        });

        console.log('✅ Chat socket event listeners setup complete');
    }

    // Chat-Nachricht senden
    sendChatMessage(context = 'lobby') {
        console.log(`Sending chat message from ${context}...`);
        
        let messageInput, gameId;
        
        if (context === 'race_selection') {
            messageInput = document.getElementById('chatMessageInput');
            gameId = this.gameDbId || this.currentGameId;
        } else {
            messageInput = document.getElementById('lobbyChatMessageInput');
            gameId = this.currentGameId;
        }
        
        if (!messageInput) {
            console.error(`Chat input not found for context: ${context}`);
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
        
        console.log(`Sending ${context} message:`, { gameId, playerName: this.playerName, message });
        
        this.socket.emit('send_chat_message', {
            gameId: gameId,
            playerName: this.playerName,
            message: message,
            timestamp: Date.now()
        });
        
        messageInput.value = '';
        this.updateCharacterCounter(context);
        this.adjustTextareaHeight(messageInput);
        messageInput.focus();
        
        console.log(`${context} chat message sent successfully`);
    }
	
resetLobbyLayout() {
    const gameListSection = document.getElementById('gameListSection');
    const gameLobbySection = document.getElementById('gameLobbySection');
    
    console.log('🔧 Resetting lobby layout to default state...');
    
    // Zurück zum Standard-Layout (2-spaltiges Grid)
    if (gameListSection) {
        gameListSection.style.display = 'grid';
        gameListSection.style.gridTemplateColumns = '1fr 1fr';
        gameListSection.style.gap = '2rem';
        gameListSection.classList.add('show-grid');
        console.log('✅ GameListSection reset to grid layout');
    }
    
    // Game Lobby verstecken
    if (gameLobbySection) {
        gameLobbySection.style.display = 'none';
        console.log('✅ GameLobbySection hidden');
    }
    
    // Player info section sichtbar machen (falls versteckt)
    const playerSection = document.querySelector('.player-section');
    if (playerSection) {
        playerSection.style.display = 'block';
    }
    
    console.log('🎯 Lobby layout successfully reset to default grid');
}

// Layout-Utility: Spiel-Lobby-Layout aktivieren
activateGameLobbyLayout() {
    const gameListSection = document.getElementById('gameListSection');
    const gameLobbySection = document.getElementById('gameLobbySection');
    
    console.log('🔧 Activating game lobby layout...');
    
    // Game List verstecken
    if (gameListSection) {
        gameListSection.style.display = 'none';
        gameListSection.classList.remove('show-grid');
        console.log('✅ GameListSection hidden');
    }
    
    // Game Lobby anzeigen
    if (gameLobbySection) {
        gameLobbySection.style.display = 'flex';
        console.log('✅ GameLobbySection shown');
    }
    
    console.log('🎯 Game lobby layout successfully activated');
}

// Layout-Utility: Layout-Status debuggen
debugLayoutStatus() {
    const gameListSection = document.getElementById('gameListSection');
    const gameLobbySection = document.getElementById('gameLobbySection');
    
    console.log('=== LAYOUT DEBUG STATUS ===');
    console.log('GameListSection:', {
        display: gameListSection?.style.display || 'default',
        gridTemplateColumns: gameListSection?.style.gridTemplateColumns || 'default',
        classList: gameListSection?.classList.toString() || 'none',
        visible: gameListSection?.offsetParent !== null
    });
    
    console.log('GameLobbySection:', {
        display: gameLobbySection?.style.display || 'default',
        classList: gameLobbySection?.classList.toString() || 'none',
        visible: gameLobbySection?.offsetParent !== null
    });
    
    console.log('Current game state:', {
        currentGameId: this.currentGameId,
        isHost: this.isHost,
        isReady: this.isReady
    });
    console.log('========================');
}

    // Character Counter aktualisieren
    updateCharacterCounter(context) {
        let messageInput, charCount;
        
        if (context === 'race_selection') {
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
            
            charCount.classList.remove('warning', 'error');
            
            if (currentLength > maxLength * 0.9) {
                charCount.classList.add('warning');
            }
            if (currentLength >= maxLength) {
                charCount.classList.add('error');
            }
            
            console.log(`Updated ${context} character counter: ${currentLength}/${maxLength}`);
        }
    }

    // Textarea-Höhe anpassen
    adjustTextareaHeight(textarea) {
        if (!textarea) return;
        
        textarea.style.height = 'auto';
        const maxHeight = 120;
        const newHeight = Math.min(textarea.scrollHeight, maxHeight);
        textarea.style.height = newHeight + 'px';
    }

    // Chat-Nachricht anzeigen
    displayChatMessage(messageData, scrollToBottom = true) {
        this.addMessageToContainer('lobbyChatMessages', messageData, scrollToBottom);
        this.addMessageToContainer('chatMessages', messageData, scrollToBottom);
    }

    // Nachricht zu Container hinzufügen
    addMessageToContainer(containerId, messageData, scrollToBottom = true) {
        const chatMessages = document.getElementById(containerId);
        if (!chatMessages) return;

        const existingMessages = chatMessages.querySelectorAll('.chat-message');
        const messageId = `${messageData.playerName}-${messageData.timestamp}`;
        
        for (let msg of existingMessages) {
            if (msg.getAttribute('data-message-id') === messageId) {
                return;
            }
        }

        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        messageElement.setAttribute('data-message-id', messageId);
        
        const isOwnMessage = messageData.playerName === this.playerName;
        if (isOwnMessage) {
            messageElement.classList.add('own-message');
        }

        const timestamp = new Date(messageData.timestamp).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit'
        });

        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-author">${this.escapeHtml(messageData.playerName)}</span>
                <span class="message-timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${this.escapeHtml(messageData.message)}</div>
        `;

        chatMessages.appendChild(messageElement);

        if (scrollToBottom) {
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 10);
        }
    }

    // HTML escapen
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // System-Nachricht hinzufügen
    addSystemMessage(message) {
        const systemMessage = {
            playerName: 'System',
            message: message,
            timestamp: Date.now(),
            isSystem: true
        };
        
        this.displayChatMessage(systemMessage);
    }

    // Chat-Nachrichten löschen
    clearChatMessages() {
        const lobbyChatMessages = document.getElementById('lobbyChatMessages');
        const raceSelectionChatMessages = document.getElementById('chatMessages');
        
        if (lobbyChatMessages) {
            lobbyChatMessages.innerHTML = '';
        }
        if (raceSelectionChatMessages) {
            raceSelectionChatMessages.innerHTML = '';
        }
        
        console.log('Chat messages cleared');
    }

    // Chat-Room beitreten
    joinChatRoom(gameId) {
        if (!this.socket || !gameId || !this.playerName) {
            console.error('Cannot join chat room: missing requirements');
            return;
        }

        console.log(`Joining chat room for game: ${gameId}`);
        this.socket.emit('join_chat_room', {
            gameId: gameId,
            playerName: this.playerName
        });
    }

    // Chat-Room verlassen
    leaveChatRoom(gameId) {
        if (!this.socket || !gameId || !this.playerName) return;

        console.log(`Leaving chat room for game: ${gameId}`);
        this.socket.emit('leave_chat_room', {
            gameId: gameId,
            playerName: this.playerName
        });
    }

    // Chat-Nachrichten übertragen
    transferChatMessages() {
        const lobbyChatMessages = document.getElementById('lobbyChatMessages');
        const raceSelectionChatMessages = document.getElementById('chatMessages');
        
        if (lobbyChatMessages && raceSelectionChatMessages) {
            raceSelectionChatMessages.innerHTML = lobbyChatMessages.innerHTML;
            
            setTimeout(() => {
                raceSelectionChatMessages.scrollTop = raceSelectionChatMessages.scrollHeight;
            }, 100);
            
            console.log('Chat messages transferred to race selection');
        }
    }

    // UI-State aktualisieren
    updateUIState() {
        const createGameBtn = document.getElementById('createGameBtn');
        
        if (createGameBtn) {
            createGameBtn.disabled = !this.playerName;
        }
        
        // joinGameBtn Code entfernen, da Button nicht mehr existiert
    }

    // Verfügbare Spiele laden
    loadAvailableGames() {
        console.log('Loading available games...');
        this.socket.emit('get_games');
    }

    // Neue Methode in StrategyGameClient Klasse
    createGameDirectly() {
        // Validierung
        if (!this.playerName) {
            showNotification('Bitte gib zuerst einen Spielernamen ein', 'error');
            return;
        }
        
        // Werte direkt aus den Hauptformular-Feldern lesen
        const gameNameInput = document.getElementById('gameName');
        const maxPlayersInput = document.getElementById('maxPlayers');
        const mapSizeInput = document.getElementById('mapSize');
        
        if (!gameNameInput || !maxPlayersInput || !mapSizeInput) {
            showNotification('Fehler: Eingabefelder nicht gefunden', 'error');
            return;
        }
        
        const gameName = gameNameInput.value.trim();
        const maxPlayers = parseInt(maxPlayersInput.value);
        const mapSize = parseInt(mapSizeInput.value);
        
        // Validierung der Eingaben
        if (!gameName) {
            showNotification('Bitte gib einen Spielnamen ein', 'error');
            gameNameInput.focus();
            return;
        }
        
        if (maxPlayers < 2 || maxPlayers > 8) {
            showNotification('Spieleranzahl muss zwischen 2 und 8 liegen', 'error');
            return;
        }
        
        console.log('Creating game directly:', { gameName, maxPlayers, mapSize, playerName: this.playerName });
        
        // Spiel erstellen
        this.socket.emit('create_game', {
            gameName: gameName,
            playerName: this.playerName,
            maxPlayers: maxPlayers,
            mapSize: mapSize
        });
        
        // Loading-Anzeige
        showNotification('Spiel wird erstellt...', 'info');
    }

    // VERBESSERTE leaveCurrentGame Methode mit vollständigem Cleanup
async leaveCurrentGame() {
    if (!this.currentGameId) {
        console.warn('No current game to leave');
        showNotification('Du bist in keinem Spiel', 'warning');
        return;
    }

    console.log('🚪 Leaving current game:', this.currentGameId);
    
    if (!confirm('Möchtest du das Spiel wirklich verlassen?')) {
        return;
    }

    try {
        const gameId = this.currentGameId;
        const gameDbId = this.gameDbId;  // ← DIESE ZEILE HINZUFÜGEN
        
        this.socket.emit('leave_game', {
            gameId: gameId,
            gameDbId: gameDbId  // ← DIESE ZEILE HINZUFÜGEN
        });
        
        this.resetGameState();  // ← DIESE ZEILE HINZUFÜGEN (statt einzelne null-Zuweisungen)
        this.hideGameLobby();
        this.hideRaceSelection();
        
        showNotification('Spiel verlassen...', 'info');
        
        setTimeout(() => {
            this.loadAvailableGames();
        }, 500);
        
    } catch (error) {
        console.error('Error leaving game:', error);
        showNotification('Fehler beim Verlassen des Spiels', 'error');
    }
}

    // Ready-Status umschalten
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

    // Spiel starten
startGame() {
    if (!this.isHost) {
        showNotification('Nur der Host kann das Spiel starten', 'error');
        return;
    }

    if (!this.currentGameId) {
        showNotification('Kein aktives Spiel gefunden', 'error');
        return;
    }

    console.log(`Starting game ${this.currentGameId} (DB: ${this.gameDbId})`);
    
    this.socket.emit('start_game', {
        gameId: this.currentGameId,
        gameDbId: this.gameDbId  // ← DIESE ZEILE HINZUFÜGEN
    });
    
    showNotification('Spiel wird gestartet...', 'info');
}

    // VERBESSERTE showGameLobby Methode
showGameLobby(data) {
    console.log('🏠 Showing game lobby with layout manager');
    
    // Layout Manager verwenden
    if (window.layoutManager) {
        window.layoutManager.showGameLobbyLayout();
    } else {
        // Fallback ohne Layout Manager
        this.activateGameLobbyLayoutFallback();
    }
    
    // Game info anzeigen
    const currentGameName = document.getElementById('currentGameName');
    const currentGamePlayerCount = document.getElementById('currentGamePlayerCount');
    const currentGameMaxPlayers = document.getElementById('currentGameMaxPlayers');
    const currentGameMapSize = document.getElementById('currentGameMapSize');
    const startBtn = document.getElementById('startGameBtn');
    
    if (currentGameName) currentGameName.textContent = data.gameName;
    if (currentGamePlayerCount) currentGamePlayerCount.textContent = data.players ? data.players.length : 0;
    if (currentGameMaxPlayers) currentGameMaxPlayers.textContent = data.maxPlayers;
    if (currentGameMapSize) currentGameMapSize.textContent = `${data.mapSize}x${data.mapSize}`;
    
    if (startBtn) {
        if (this.isHost) {
            startBtn.style.display = 'inline-block';
            startBtn.disabled = true;
        } else {
            startBtn.style.display = 'none';
        }
    }
    
    // Ready-Button zurücksetzen
    const readyBtn = document.getElementById('readyBtn');
    if (readyBtn) {
        this.isReady = false;
        readyBtn.textContent = 'Bereit';
        readyBtn.classList.remove('btn-secondary');
        readyBtn.classList.add('btn-success');
    }
    
    // Player list und counts aktualisieren
    this.updateGamePlayersList(data.players || []);
    this.updatePlayerCounts(data.players || []);
    
    // Chat für Lobby initialisieren
    setTimeout(() => {
        this.joinChatRoom(this.currentGameId);
    }, 500);
    
    console.log('✅ Game lobby shown with layout manager');
}

    // VERBESSERTE hideGameLobby Methode mit vollständigem Cleanup
hideGameLobby() {
    console.log('🏠 Hiding game lobby with layout manager');
    
    // Layout Manager verwenden
    if (window.layoutManager) {
        window.layoutManager.showDefaultLayout();
    } else {
        // Fallback ohne Layout Manager
        this.resetLobbyLayoutFallback();
    }
    
    // Lokalen Zustand zurücksetzen
    this.currentGameId = null;
    this.isHost = false;
    this.isReady = false;
    
    // UI-Elemente zurücksetzen
    const readyBtn = document.getElementById('readyBtn');
    if (readyBtn) {
        readyBtn.textContent = 'Bereit';
        readyBtn.classList.remove('btn-secondary');
        readyBtn.classList.add('btn-success');
    }
    
    const playersList = document.getElementById('gameLobbyPlayersList');
    if (playersList) {
        playersList.innerHTML = '';
    }
    
    const lobbyStatusText = document.getElementById('lobbyStatusText');
    if (lobbyStatusText) {
        lobbyStatusText.textContent = 'Warte auf andere Spieler...';
    }
    
    const readyStatusText = document.getElementById('readyStatusText');
    if (readyStatusText) {
        readyStatusText.innerHTML = 'Bereit: <span id="readyCount">0</span>/<span id="totalPlayers">0</span>';
    }
    
    console.log('✅ Game lobby hidden and layout reset');
}

// Fallback-Methoden für den Fall, dass Layout Manager nicht verfügbar ist
activateGameLobbyLayoutFallback() {
    console.log('🔧 Using fallback layout activation');
    
    const gameListSection = document.getElementById('gameListSection');
    const gameLobbySection = document.getElementById('gameLobbySection');
    
    if (gameListSection) {
        gameListSection.style.display = 'none';
    }
    
    if (gameLobbySection) {
        gameLobbySection.style.display = 'block';
    }
}

resetLobbyLayoutFallback() {
    console.log('🔧 Using fallback layout reset');
    
    const gameListSection = document.getElementById('gameListSection');
    const gameLobbySection = document.getElementById('gameLobbySection');
    
    if (gameListSection) {
        gameListSection.style.display = 'grid';
        gameListSection.style.gridTemplateColumns = '1fr 1fr';
        gameListSection.style.gap = '2rem';
    }
    
    if (gameLobbySection) {
        gameLobbySection.style.display = 'none';
    }
}

// NEUE Methode: Layout testen
testLayoutTransitions() {
    console.log('🧪 Testing layout transitions...');
    
    if (window.layoutManager) {
        // Test 1: Zu Game Lobby wechseln
        setTimeout(() => {
            console.log('Test 1: Switching to game lobby');
            window.layoutManager.showGameLobbyLayout();
        }, 1000);
        
        // Test 2: Zurück zu Default
        setTimeout(() => {
            console.log('Test 2: Switching back to default');
            window.layoutManager.showDefaultLayout();
        }, 3000);
        
        // Test 3: Sofortige Änderung
        setTimeout(() => {
            console.log('Test 3: Immediate change to game lobby');
            window.layoutManager.setLayoutImmediate('game-lobby');
        }, 5000);
        
        // Test 4: Reset
        setTimeout(() => {
            console.log('Test 4: Reset');
            window.layoutManager.reset();
        }, 7000);
    } else {
        console.log('❌ Layout Manager not available for testing');
    }
}

// Event-Listener für Layout-Änderungen hinzufügen
setupLayoutEventListeners() {
    window.addEventListener('layoutChanged', (event) => {
        console.log('📐 Layout changed detected:', event.detail);
        
        // Hier können zusätzliche Aktionen ausgeführt werden
        // wenn sich das Layout ändert
        
        if (event.detail.layout === 'game-lobby') {
            // Game lobby ist jetzt aktiv
            this.onGameLobbyActivated();
        } else if (event.detail.layout === 'default') {
            // Default layout ist jetzt aktiv
            this.onDefaultLayoutActivated();
        }
    });
}

// Callback-Methoden für Layout-Änderungen
onGameLobbyActivated() {
    console.log('🎮 Game lobby layout activated');
    // Hier können spezifische Aktionen für die Game Lobby ausgeführt werden
}

onDefaultLayoutActivated() {
    console.log('🏠 Default layout activated');
    // Hier können spezifische Aktionen für das Default Layout ausgeführt werden
    // z.B. Spiele-Liste neu laden
    setTimeout(() => {
        this.loadAvailableGames();
    }, 300);
}

    // VERBESSERTE updateReadyStatus Methode
    updateReadyStatus(data) {
        console.log('Updating ready status:', data);
        
        const lobbyStatusText = document.getElementById('lobbyStatusText');
        const startBtn = document.getElementById('startGameBtn');
        
        // Update ready counts
        if (data.players) {
            this.updatePlayerCounts(data.players);
        }
        
        // Update status text and button
        if (data.canStart && this.isHost) {
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
        
        // Update player list if provided
        if (data.players) {
            this.updateGamePlayersList(data.players);
        }
    }

    // Race Selection anzeigen
showRaceSelection() {
    const modal = document.getElementById('raceSelectionModal');
    if (!modal) return;

    modal.style.display = 'block';
    this.currentChatContext = 'race_selection';
    
    this.transferChatMessages();
    
    setTimeout(() => {
        this.setupRaceSelectionChatListeners();
    }, 100);
    
    // KORRIGIERT: Verwende DB-ID für Race Selection
    console.log(`Joining race selection with DB ID: ${this.gameDbId}`);
    
    this.socket.emit('join-race-selection', {
        gameId: this.currentGameId,
        gameDbId: this.gameDbId,
        playerName: this.playerName
    });
    
    this.socket.emit('get-available-races', {
        gameId: this.gameDbId || this.currentGameId
    });
    
    console.log('Race selection modal shown');
}

    // Race Selection verstecken
    hideRaceSelection() {
        const modal = document.getElementById('raceSelectionModal');
        if (modal) {
            modal.style.display = 'none';
            this.currentChatContext = 'lobby';
        }
    }

    // Games List aktualisieren
    updateGamesList(games) {
        const gamesList = document.getElementById('gamesList');
        if (!gamesList) return;
        
        gamesList.innerHTML = '';
        
        if (games.length === 0) {
            gamesList.innerHTML = '<div class="no-games">Keine Spiele verfügbar</div>';
            return;
        }
        
        // In lobby.js - updateGamesList Funktion
        games.forEach(game => {
            const gameItem = document.createElement('div');
            gameItem.className = 'game-item';
            gameItem.dataset.gameId = game.id;
            
            gameItem.innerHTML = `
                <div class="game-info">
                    <h4>${this.escapeHtml(game.name)}</h4>
                    <p>Spieler: ${game.currentPlayers}/${game.maxPlayers}</p>
                    <p>Kartengröße: ${game.mapSize}x${game.mapSize}</p>
                </div>
                <div class="game-actions">
                    <button class="btn btn-primary join-game-btn" ${game.currentPlayers >= game.maxPlayers ? 'disabled' : ''}>
                        ${game.currentPlayers >= game.maxPlayers ? 'Voll' : 'Beitreten'}
                    </button>
                </div>
            `;
            
            // Event-Listener für den Beitreten-Button hinzufügen
            const joinBtn = gameItem.querySelector('.join-game-btn');
            if (joinBtn && !joinBtn.disabled) {
                joinBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Verhindert, dass das gameItem-Click Event ausgelöst wird
                    this.joinGame(game.id, game.name);
                });
            }
            
            gamesList.appendChild(gameItem);
        });
    }
	
    joinGame(gameId, gameName) {
        if (!this.playerName) {
            showNotification('Bitte gib zuerst einen Spielernamen ein', 'error');
            return;
        }
        
        console.log('Joining game:', gameId, gameName);
        
        this.socket.emit('join_game', {
            gameId: gameId,
            playerName: this.playerName
        });
    }

    // VERBESSERTE updateGamePlayersList Methode mit besserer Fehlerbehandlung
    updateGamePlayersList(players) {
        const playersList = document.getElementById('gameLobbyPlayersList');
        if (!playersList) {
            console.warn('gameLobbyPlayersList element not found');
            return;
        }
        
        playersList.innerHTML = '';
        
        if (!players || !Array.isArray(players)) {
            console.warn('Invalid players data:', players);
            return;
        }
        
        players.forEach(player => {
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            if (player.ready || player.isReady) {
                playerItem.classList.add('ready');
            }
            
            if (player.isHost) {
                playerItem.classList.add('host');
            }
            
            playerItem.innerHTML = `
                <span class="player-name">${this.escapeHtml(player.name)}</span>
                <span class="player-status">
                    ${player.isHost ? '👑 ' : ''}
                    ${(player.ready || player.isReady) ? '✅ Bereit' : '⏳ Wartet'}
                </span>
            `;
            
            playersList.appendChild(playerItem);
        });
        
        console.log(`Updated player list: ${players.length} players`);
    }

    // NEUE Methode: Game Info aktualisieren
    updateGameInfo(data) {
        const currentGamePlayerCount = document.getElementById('currentGamePlayerCount');
        const currentGameMaxPlayers = document.getElementById('currentGameMaxPlayers');
        
        if (currentGamePlayerCount) {
            currentGamePlayerCount.textContent = data.currentPlayers || data.players?.length || 0;
        }
        
        if (currentGameMaxPlayers && data.maxPlayers) {
            currentGameMaxPlayers.textContent = data.maxPlayers;
        }
        
        console.log(`Game info updated: ${data.currentPlayers || data.players?.length}/${data.maxPlayers} players`);
    }

    // NEUE Methode: Player Counts aktualisieren
    updatePlayerCounts(players) {
        if (!players) return;
        
        // Update main player count display
        const currentGamePlayerCount = document.getElementById('currentGamePlayerCount');
        if (currentGamePlayerCount) {
            currentGamePlayerCount.textContent = players.length;
        }
        
        // Update ready status counts
        const readyCount = players.filter(p => p.ready || p.isReady).length;
        const totalPlayers = players.length;
        
        const readyCountElement = document.getElementById('readyCount');
        const totalPlayersElement = document.getElementById('totalPlayers');
        
        if (readyCountElement) readyCountElement.textContent = readyCount;
        if (totalPlayersElement) totalPlayersElement.textContent = totalPlayers;
        
        console.log(`Player counts updated: ${players.length} total, ${readyCount} ready`);
    }

    // Verfügbare Rassen anzeigen
    displayRaces() {
        const racesList = document.getElementById('racesList');
        if (!racesList || !this.availableRaces) return;
        
        racesList.innerHTML = '';
        
        this.availableRaces.forEach(race => {
            const raceItem = document.createElement('div');
            raceItem.className = 'race-item';
            raceItem.dataset.raceId = race.id;
            
            raceItem.innerHTML = `
                <div class="race-info">
                    <h4>${this.escapeHtml(race.name)}</h4>
                    <p>${this.escapeHtml(race.description)}</p>
                </div>
            `;
            
            raceItem.addEventListener('click', () => {
                this.selectRace(race.id);
            });
            
            racesList.appendChild(raceItem);
        });
    }

    // Rasse auswählen
    selectRace(raceId) {
        console.log('Selecting race:', raceId);
        
        // UI aktualisieren
        document.querySelectorAll('.race-item').forEach(item => item.classList.remove('selected'));
        const selectedRaceItem = document.querySelector(`[data-race-id="${raceId}"]`);
        if (selectedRaceItem) {
            selectedRaceItem.classList.add('selected');
        }
        
        this.selectedRace = raceId;
        
        // Confirm button aktivieren
        const confirmBtn = document.getElementById('confirmRaceBtn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
        }
        
        // Server benachrichtigen
        this.socket.emit('select_race', {
            gameId: this.gameDbId,
            playerName: this.playerName,
            raceId: raceId
        });
    }

    // Rassenauswahl bestätigen
    confirmRaceSelection() {
        if (!this.selectedRace) {
            showNotification('Bitte wähle zuerst eine Rasse aus', 'error');
            return;
        }
        
        console.log('Confirming race selection:', this.selectedRace);
        
        this.socket.emit('confirm_race', {
            gameId: this.gameDbId,
            playerName: this.playerName,
            raceId: this.selectedRace
        });
        
        // Button deaktivieren
        const confirmBtn = document.getElementById('confirmRaceBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Rasse bestätigt';
        }
    }

    // Race Selection Display aktualisieren
    updateRaceSelectionDisplay(data) {
        console.log('Updating race selection display:', data);
        
        const raceSelectionPlayersList = document.getElementById('raceSelectionPlayersList');
        if (!raceSelectionPlayersList) return;
        
        raceSelectionPlayersList.innerHTML = '';
        
        if (data.players) {
            data.players.forEach(player => {
                const playerItem = document.createElement('div');
                playerItem.className = 'race-player-item';
                
                if (player.raceConfirmed) {
                    playerItem.classList.add('confirmed');
                }
                
                playerItem.innerHTML = `
                    <span class="player-name">${this.escapeHtml(player.name)}</span>
                    <span class="race-status">
                        ${player.selectedRace ? `🎭 ${player.selectedRace}` : '⏳ Wählt...'}
                        ${player.raceConfirmed ? ' ✅' : ''}
                    </span>
                `;
                
                raceSelectionPlayersList.appendChild(playerItem);
            });
        }
        
        // Status-Text aktualisieren
        const raceSelectionStatus = document.getElementById('raceSelectionStatus');
        if (raceSelectionStatus) {
            if (data.allConfirmed) {
                raceSelectionStatus.textContent = 'Alle Spieler haben ihre Rasse gewählt! Das Spiel wird gestartet...';
                raceSelectionStatus.className = 'status success';
            } else {
                const confirmedCount = data.players ? data.players.filter(p => p.raceConfirmed).length : 0;
                const totalCount = data.players ? data.players.length : 0;
                raceSelectionStatus.textContent = `Warte auf andere Spieler... (${confirmedCount}/${totalCount} bereit)`;
                raceSelectionStatus.className = 'status waiting';
            }
        }
    }

    // Modals schließen
    closeModals() {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.style.display = 'none';
        });
        
        // Form-Felder zurücksetzen
        const forms = document.querySelectorAll('.modal form');
        forms.forEach(form => {
            form.reset();
        });
    }

    // Debug-Methode für Chat-Status
    debugChatStatus() {
        console.log('=== CHAT DEBUG STATUS ===');
        console.log('Current game ID:', this.currentGameId);
        console.log('Player name:', this.playerName);
        console.log('Chat context:', this.currentChatContext);
        console.log('Socket connected:', this.socket?.connected);
        
        const elements = {
            'lobbyChatInput': document.getElementById('lobbyChatMessageInput'),
            'lobbyChatSend': document.getElementById('lobbyChatSendButton'),
            'lobbyChatMessages': document.getElementById('lobbyChatMessages'),
            'lobbyChatCharCount': document.getElementById('lobbyChatCharCount'),
            'raceSelectionChatInput': document.getElementById('chatMessageInput'),
            'raceSelectionChatSend': document.getElementById('chatSendButton'),
            'raceSelectionChatMessages': document.getElementById('chatMessages'),
            'raceSelectionCharCount': document.getElementById('chatCharCount')
        };
        
        Object.entries(elements).forEach(([name, element]) => {
            console.log(`${name}:`, element ? '✅ Found' : '❌ Missing');
        });
        
        console.log('========================');
    }

    // Test-Methode für Chat
    testChat() {
        console.log('🧪 Testing chat functionality...');
        this.debugChatStatus();
        
        if (this.currentGameId && this.playerName) {
            const testMessage = `Test message at ${new Date().toLocaleTimeString()}`;
            this.socket.emit('send_chat_message', {
                gameId: this.currentGameId,
                playerName: this.playerName,
                message: testMessage,
                timestamp: Date.now()
            });
            console.log('🧪 Test message sent:', testMessage);
        } else {
            console.log('🧪 Cannot test: missing gameId or playerName');
        }
    }
	
	selectRace(raceId) {
        if (!raceId) {
            showNotification('Bitte wähle eine Rasse aus', 'error');
            return;
        }

        console.log(`Selecting race ${raceId} for game ${this.gameDbId || this.currentGameId}`);
        
        this.socket.emit('select-race', {
            gameId: this.gameDbId || this.currentGameId,
            raceId: raceId
        });
    }

    confirmRaceSelection() {
        if (!this.selectedRace) {
            showNotification('Bitte wähle zuerst eine Rasse aus', 'error');
            return;
        }

        console.log(`Confirming race ${this.selectedRace} for game ${this.gameDbId || this.currentGameId}`);
        
        this.socket.emit('confirm-race', {
            gameId: this.gameDbId || this.currentGameId,
            raceId: this.selectedRace
        });
    }

    updateRaceSelectionUI() {
        // Update UI elements to reflect current race selection
        const raceCards = document.querySelectorAll('.race-card');
        raceCards.forEach(card => {
            card.classList.remove('selected', 'confirmed');
            if (card.dataset.raceId == this.selectedRace) {
                card.classList.add('selected');
            }
        });
    }

    updateRaceSelectionDisplay(data) {
        // Update display with other players' selections
        console.log('Updating race selection display:', data);
        // Implementation depends on your UI structure
    }

    // Error Handling
    handleSocketError(error) {
        console.error('Socket Error:', error);
        
        if (error.includes('Spiel nicht gefunden')) {
            showNotification('Spiel nicht gefunden. Lade verfügbare Spiele neu...', 'warning');
            this.resetGameState();
            this.hideGameLobby();
            this.hideRaceSelection();
            setTimeout(() => {
                this.loadAvailableGames();
            }, 1000);
        } else {
            showNotification('Fehler: ' + error, 'error');
        }
    }

    resetGameState() {
        this.currentGameId = null;
        this.gameDbId = null;
        this.gameState = null;
        this.isHost = false;
        this.isReady = false;
        this.selectedRace = null;
        this.availableRaces = [];
        this.currentPlayers = [];
        
        console.log('🔄 Game state reset');
    }

    // Debug Helper
    debugGameIds() {
        console.log('🔍 Current Game IDs:', {
            memoryId: this.currentGameId,
            dbId: this.gameDbId,
            playerName: this.playerName,
            isHost: this.isHost
        });
    }
}

// Client initialisieren wenn DOM geladen ist
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing strategy game client...');
    window.gameClient = new StrategyGameClient();
});

// Globale Utility-Funktion für Notifications
function showNotification(message, type = 'info') {
    console.log(`Notification [${type}]:`, message);
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    const container = document.getElementById('notifications') || document.body;
    container.appendChild(notification);
    
    // Animation
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Auto-remove
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// Globale Funktionen für den Layout Manager
function showGameLobby() {
    if (window.layoutManager) {
        window.layoutManager.showGameLobbyLayout();
    }
}

function showDefaultLayout() {
    if (window.layoutManager) {
        window.layoutManager.showDefaultLayout();
    }
}

function debugLayout() {
    if (window.layoutManager) {
        console.log(window.layoutManager.getDebugInfo());
    }
}

function resetLayout() {
    if (window.layoutManager) {
        window.layoutManager.reset();
    }
}