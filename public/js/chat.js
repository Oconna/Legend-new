// Chat System for Race Selection Lobby

class ChatManager {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.playerName = '';
        this.isInitialized = false;
        this.messages = [];
        this.maxMessages = 100; // Maximum messages to keep in memory
        
        // Chat elements
        this.chatContainer = null;
        this.messagesContainer = null;
        this.messageInput = null;
        this.sendButton = null;
        this.playerCountElement = null;
        
        // Auto-scroll settings
        this.autoScroll = true;
        this.scrollThreshold = 50; // Pixels from bottom to maintain auto-scroll
    }

    // Initialize chat system
    init(socket, gameId, playerName) {
        console.log('ChatManager.init called with:', { gameId, playerName, socketConnected: socket?.connected });
        
        // Cleanup existing chat if reinitializing
        if (this.isInitialized) {
            console.log('Chat already initialized, cleaning up first...');
            this.destroy();
        }
        
        this.socket = socket;
        this.gameId = gameId;
        this.playerName = playerName;
        
        if (!this.socket || !this.gameId || !this.playerName) {
            console.error('Chat initialization failed: missing required parameters', {
                hasSocket: !!this.socket,
                hasGameId: !!this.gameId,
                hasPlayerName: !!this.playerName
            });
            return false;
        }
        
        // Bestimme Chat-Container basierend auf Kontext
        const isLobbyChat = this.determineChatContext();
        console.log('Chat context determined:', isLobbyChat ? 'lobby' : 'race_selection');
        
        this.setupChatElements(isLobbyChat);
        this.setupEventListeners(isLobbyChat);
        this.setupSocketEvents();
        
        this.isInitialized = true;
        
        console.log(`Chat initialized successfully for player ${this.playerName} in game ${this.gameId}`);
        return true;
    }
	
	determineChatContext() {
        // Prüfe ob Race Selection Modal offen ist
        const raceModal = document.getElementById('raceSelectionModal');
        const isRaceModalOpen = raceModal && raceModal.style.display === 'block';
        
        // Prüfe ob Lobby Section sichtbar ist
        const lobbySection = document.getElementById('currentGameSection');
        const isLobbyVisible = lobbySection && lobbySection.style.display !== 'none';
        
        console.log('Chat context check:', { isRaceModalOpen, isLobbyVisible });
        
        // Race Selection hat Priorität
        return !isRaceModalOpen && isLobbyVisible;
    }

    // Setup chat HTML elements
    setupChatElements(isLobbyChat = false) {
        if (isLobbyChat) {
            // Lobby Chat Elements
            this.chatContainer = document.getElementById('lobbyChat');
            this.messagesContainer = document.getElementById('lobbyChatMessages');
            this.messageInput = document.getElementById('lobbyChatMessageInput');
            this.sendButton = document.getElementById('lobbyChatSendButton');
            this.playerCountElement = document.getElementById('lobbyChatPlayerCount');
            
            console.log('Setting up lobby chat elements');
        } else {
            // Race Selection Chat Elements
            this.chatContainer = document.getElementById('raceSelectionChat');
            this.messagesContainer = document.getElementById('chatMessages');
            this.messageInput = document.getElementById('chatMessageInput');
            this.sendButton = document.getElementById('chatSendButton');
            this.playerCountElement = document.getElementById('chatPlayerCount');
            
            console.log('Setting up race selection chat elements');
        }
        
        if (!this.chatContainer) {
            console.error('Chat container not found in DOM for context:', isLobbyChat ? 'lobby' : 'race_selection');
            return;
        }
        
        // Show chat container
        this.chatContainer.style.display = 'block';
        console.log('Chat container shown');
        
        // Clear any existing messages
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
            console.log('Messages container cleared');
        }
        
        // Add welcome message
        this.addSystemMessage(`Willkommen ${this.playerName}! Du kannst hier mit anderen Spielern chatten.`);
    }

    // Setup event listeners for chat interactions
    setupEventListeners(isLobbyChat = false) {
        if (!this.messageInput || !this.sendButton) {
            console.error('Chat input elements not found');
            return;
        }
        
        console.log('Setting up chat event listeners for context:', isLobbyChat ? 'lobby' : 'race_selection');
        
        // Remove existing listeners to prevent duplicates
        this.messageInput.removeEventListener('keypress', this.keypressHandler);
        this.sendButton.removeEventListener('click', this.clickHandler);
        this.messageInput.removeEventListener('input', this.inputHandler);
        
        // Create bound handlers to maintain context
        this.keypressHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        };
        
        this.clickHandler = () => {
            this.sendMessage();
        };
        
        this.inputHandler = () => {
            this.adjustTextareaHeight();
        };
        
        // Add event listeners
        this.sendButton.addEventListener('click', this.clickHandler);
        this.messageInput.addEventListener('keypress', this.keypressHandler);
        this.messageInput.addEventListener('input', this.inputHandler);
        
        // Handle scroll events for auto-scroll detection
        if (this.messagesContainer) {
            this.messagesContainer.addEventListener('scroll', () => {
                this.handleScroll();
            });
        }
        
        // Focus input when chat is opened
        setTimeout(() => {
            if (this.messageInput) {
                this.messageInput.focus();
            }
        }, 100);
        
        console.log('Chat event listeners setup complete');
    }

    // Setup socket event listeners for chat
    setupSocketEvents() {
        if (!this.socket) return;
        
        // Receive chat message
        this.socket.on('chat_message', (data) => {
            this.handleIncomingMessage(data);
        });
        
        // Player joined chat
        this.socket.on('chat_player_joined', (data) => {
            this.addSystemMessage(`${data.playerName} ist dem Chat beigetreten`);
            this.updatePlayerCount(data.playerCount);
        });
        
        // Player left chat
        this.socket.on('chat_player_left', (data) => {
            this.addSystemMessage(`${data.playerName} hat den Chat verlassen`);
            this.updatePlayerCount(data.playerCount);
        });
        
        // Chat history (when rejoining)
        this.socket.on('chat_history', (data) => {
            this.loadChatHistory(data.messages);
        });
        
        // Update player count
        this.socket.on('chat_player_count', (data) => {
            this.updatePlayerCount(data.count);
        });
    }

    // Send a chat message
    sendMessage() {
        if (!this.isInitialized || !this.messageInput) return;
        
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        // Validate message length
        if (message.length > 500) {
            this.addSystemMessage('Nachricht ist zu lang (max. 500 Zeichen)', 'error');
            return;
        }
        
        // Send message to server
        this.socket.emit('send_chat_message', {
            gameId: this.gameId,
            playerName: this.playerName,
            message: message,
            timestamp: Date.now()
        });
        
        // Clear input
        this.messageInput.value = '';
        this.adjustTextareaHeight();
        this.messageInput.focus();
    }

    // Handle incoming chat message
    handleIncomingMessage(data) {
        if (!data || !data.playerName || !data.message) return;
        
        this.addChatMessage(data.playerName, data.message, data.timestamp, data.playerId);
    }

    // Add a chat message to the display
    addChatMessage(playerName, message, timestamp, playerId = null) {
        if (!this.messagesContainer) return;
        
        const messageElement = this.createMessageElement(playerName, message, timestamp, playerId);
        this.messagesContainer.appendChild(messageElement);
        
        // Keep track of messages
        this.messages.push({
            playerName: playerName,
            message: message,
            timestamp: timestamp,
            playerId: playerId
        });
        
        // Limit message history
        if (this.messages.length > this.maxMessages) {
            this.messages.shift();
            const firstMessage = this.messagesContainer.firstChild;
            if (firstMessage) {
                this.messagesContainer.removeChild(firstMessage);
            }
        }
        
        // Auto-scroll if needed
        if (this.autoScroll) {
            this.scrollToBottom();
        }
    }

    // Add a system message
    addSystemMessage(message, type = 'info') {
        if (!this.messagesContainer) return;
        
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message system-message ${type}`;
        messageElement.innerHTML = `
            <div class="message-content">
                <span class="system-text">${this.escapeHtml(message)}</span>
                <span class="message-time">${this.formatTime(Date.now())}</span>
            </div>
        `;
        
        this.messagesContainer.appendChild(messageElement);
        
        if (this.autoScroll) {
            this.scrollToBottom();
        }
    }

    // Create a message element
    createMessageElement(playerName, message, timestamp, playerId) {
        const messageElement = document.createElement('div');
        const isOwnMessage = playerName === this.playerName;
        
        messageElement.className = `chat-message ${isOwnMessage ? 'own-message' : 'other-message'}`;
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="player-name">${this.escapeHtml(playerName)}</span>
                <span class="message-time">${this.formatTime(timestamp)}</span>
            </div>
            <div class="message-content">
                ${this.formatMessage(message)}
            </div>
        `;
        
        return messageElement;
    }

    // Format message content (handle line breaks, etc.)
    formatMessage(message) {
        return this.escapeHtml(message)
            .replace(/\n/g, '<br>')
            .replace(/:\)/g, '😊')
            .replace(/:\(/g, '😞')
            .replace(/:D/g, '😃')
            .replace(/;\)/g, '😉')
            .replace(/:P/g, '😛');
    }

    // Load chat history
    loadChatHistory(messages) {
        if (!messages || !Array.isArray(messages)) return;
        
        // Clear current messages
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
        this.messages = [];
        
        // Add each message
        messages.forEach(msg => {
            this.addChatMessage(msg.playerName, msg.message, msg.timestamp, msg.playerId);
        });
        
        this.addSystemMessage('Chat-Verlauf geladen');
    }

    // Update player count display
    updatePlayerCount(count) {
        if (this.playerCountElement) {
            this.playerCountElement.textContent = count;
        }
    }

    // Auto-adjust textarea height
    adjustTextareaHeight() {
        if (!this.messageInput) return;
        
        this.messageInput.style.height = 'auto';
        const newHeight = Math.min(this.messageInput.scrollHeight, 100); // Max 100px
        this.messageInput.style.height = newHeight + 'px';
    }

    // Handle scroll events
    handleScroll() {
        if (!this.messagesContainer) return;
        
        const container = this.messagesContainer;
        const isNearBottom = container.scrollTop + container.clientHeight >= 
                           container.scrollHeight - this.scrollThreshold;
        
        this.autoScroll = isNearBottom;
    }

    // Scroll to bottom
    scrollToBottom() {
        if (!this.messagesContainer) return;
        
        setTimeout(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }, 10);
    }

    // Format timestamp
    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Show/hide chat
    show() {
        if (this.chatContainer) {
            this.chatContainer.style.display = 'block';
            if (this.messageInput) {
                this.messageInput.focus();
            }
        }
    }

    // UPDATED: hide Methode - verstecke alle Chat-Container
    hide() {
        // Hide all possible chat containers
        const containers = [
            document.getElementById('lobbyChat'),
            document.getElementById('raceSelectionChat')
        ];
        
        containers.forEach(container => {
            if (container) {
                container.style.display = 'none';
            }
        });
    }
	
	// DEBUG: Methode zum Anzeigen des Chat-Status
    getDebugInfo() {
        return {
            isInitialized: this.isInitialized,
            gameId: this.gameId,
            playerName: this.playerName,
            hasSocket: !!this.socket,
            socketConnected: this.socket?.connected,
            hasChatContainer: !!this.chatContainer,
            hasMessagesContainer: !!this.messagesContainer,
            hasMessageInput: !!this.messageInput,
            hasSendButton: !!this.sendButton,
            messageCount: this.messages.length,
            chatContainerVisible: this.chatContainer?.style.display !== 'none'
        };
    }

    // Clear chat messages
    clear() {
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
        this.messages = [];
    }

    // Cleanup chat system
    destroy() {
        console.log('Destroying chat system...');
        
        // Remove socket listeners
        if (this.socket) {
            this.socket.off('chat_message');
            this.socket.off('chat_player_joined');
            this.socket.off('chat_player_left');
            this.socket.off('chat_history');
            this.socket.off('chat_player_count');
        }
        
        // Remove DOM event listeners
        if (this.messageInput && this.keypressHandler) {
            this.messageInput.removeEventListener('keypress', this.keypressHandler);
            this.messageInput.removeEventListener('input', this.inputHandler);
        }
        
        if (this.sendButton && this.clickHandler) {
            this.sendButton.removeEventListener('click', this.clickHandler);
        }
        
        // Clear references
        this.keypressHandler = null;
        this.clickHandler = null;
        this.inputHandler = null;
        
        this.isInitialized = false;
        this.clear();
        this.hide();
        
        // Reset properties
        this.chatContainer = null;
        this.messagesContainer = null;
        this.messageInput = null;
        this.sendButton = null;
        this.playerCountElement = null;
        
        console.log('Chat system destroyed completely');
    }
	
	// NEUE Methode: Switch zwischen Chat-Kontexten
    switchContext(isLobbyChat) {
        console.log('Switching chat context to:', isLobbyChat ? 'lobby' : 'race_selection');
        
        if (!this.isInitialized) {
            console.warn('Chat not initialized, cannot switch context');
            return false;
        }
        
        // Hide current context
        this.hide();
        
        // Setup new context
        this.setupChatElements(isLobbyChat);
        this.setupEventListeners(isLobbyChat);
        
        return true;
    }

    // Get chat statistics
    getStats() {
        return {
            isInitialized: this.isInitialized,
            messageCount: this.messages.length,
            autoScroll: this.autoScroll,
            gameId: this.gameId,
            playerName: this.playerName
        };
    }
}

// Global chat manager instance
window.chatManager = null;

// Initialize chat when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Chat will be initialized by lobby manager when race selection starts
    console.log('Chat manager ready for initialization');
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatManager;
}