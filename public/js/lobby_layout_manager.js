// Layout Manager für das Strategiespiel - lobby_layout_manager.js

class LobbyLayoutManager {
    constructor() {
        this.currentState = 'default'; // 'default' | 'game-lobby'
        this.animationDuration = 300;
        this.elements = {
            lobbyMain: null,
            lobbySection: null,
            gameLobbySection: null,
            playerSection: null
        };
        
        this.init();
    }

    init() {
        this.findElements();
        this.setInitialState();
        console.log('Layout Manager initialized');
    }

    findElements() {
        this.elements = {
            lobbyMain: document.querySelector('.lobby-main'),
            lobbySection: document.getElementById('gameListSection'),
            gameLobbySection: document.getElementById('gameLobbySection'),
            playerSection: document.querySelector('.player-section')
        };

        // Validierung
        Object.entries(this.elements).forEach(([name, element]) => {
            if (!element) {
                console.warn(`Layout Manager: Element ${name} not found`);
            }
        });
    }

    setInitialState() {
        this.showDefaultLayout();
    }

    // Standard-Layout anzeigen (Spiel erstellen + Verfügbare Spiele)
    showDefaultLayout() {
        console.log('🎯 Switching to default layout');
        
        if (this.currentState === 'default') {
            console.log('Already in default layout');
            return;
        }

        this.currentState = 'default';
        
        // Body-Klasse für CSS-State setzen
        document.body.className = document.body.className.replace(/layout-state-\w+/g, '');
        document.body.classList.add('layout-state-default');

        // Smooth transition
        if (this.elements.gameLobbySection) {
            this.elements.gameLobbySection.style.animation = 'slideOutToBottom 0.3s ease-in';
            
            setTimeout(() => {
                this.elements.gameLobbySection.style.display = 'none';
                this.elements.gameLobbySection.classList.remove('active');
                this.elements.gameLobbySection.style.animation = '';
            }, this.animationDuration);
        }

        if (this.elements.lobbySection) {
            setTimeout(() => {
                this.elements.lobbySection.style.display = 'grid';
                this.elements.lobbySection.style.gridTemplateColumns = '1fr 1fr';
                this.elements.lobbySection.style.gap = '2rem';
                this.elements.lobbySection.classList.remove('game-active');
                this.elements.lobbySection.style.animation = 'slideInFromBottom 0.3s ease-out';
                
                setTimeout(() => {
                    this.elements.lobbySection.style.animation = '';
                }, this.animationDuration);
            }, this.animationDuration / 2);
        }

        // Player Section wieder anzeigen falls versteckt
        if (this.elements.playerSection) {
            this.elements.playerSection.style.display = 'block';
        }

        this.triggerLayoutEvent('default');
        console.log('✅ Default layout activated');
    }

    // Game-Lobby-Layout anzeigen
    showGameLobbyLayout() {
        console.log('🎯 Switching to game lobby layout');
        
        if (this.currentState === 'game-lobby') {
            console.log('Already in game lobby layout');
            return;
        }

        this.currentState = 'game-lobby';
        
        // Body-Klasse für CSS-State setzen
        document.body.className = document.body.className.replace(/layout-state-\w+/g, '');
        document.body.classList.add('layout-state-game-lobby');

        // Smooth transition
        if (this.elements.lobbySection) {
            this.elements.lobbySection.style.animation = 'slideOutToBottom 0.3s ease-in';
            
            setTimeout(() => {
                this.elements.lobbySection.style.display = 'none';
                this.elements.lobbySection.classList.add('game-active');
                this.elements.lobbySection.style.animation = '';
            }, this.animationDuration);
        }

        if (this.elements.gameLobbySection) {
            setTimeout(() => {
                this.elements.gameLobbySection.style.display = 'block';
                this.elements.gameLobbySection.classList.add('active');
                this.elements.gameLobbySection.style.animation = 'slideInFromBottom 0.3s ease-out';
                
                setTimeout(() => {
                    this.elements.gameLobbySection.style.animation = '';
                }, this.animationDuration);
            }, this.animationDuration / 2);
        }

        this.triggerLayoutEvent('game-lobby');
        console.log('✅ Game lobby layout activated');
    }

    // Layout sofort ohne Animation wechseln
    setLayoutImmediate(layout) {
        console.log(`🚀 Setting layout immediately: ${layout}`);
        
        this.currentState = layout;
        
        // Body-Klasse setzen
        document.body.className = document.body.className.replace(/layout-state-\w+/g, '');
        document.body.classList.add(`layout-state-${layout}`);

        if (layout === 'default') {
            // Standard-Layout
            if (this.elements.lobbySection) {
                this.elements.lobbySection.style.display = 'grid';
                this.elements.lobbySection.style.gridTemplateColumns = '1fr 1fr';
                this.elements.lobbySection.style.gap = '2rem';
                this.elements.lobbySection.classList.remove('game-active');
            }
            
            if (this.elements.gameLobbySection) {
                this.elements.gameLobbySection.style.display = 'none';
                this.elements.gameLobbySection.classList.remove('active');
            }
            
            if (this.elements.playerSection) {
                this.elements.playerSection.style.display = 'block';
            }
        } else if (layout === 'game-lobby') {
            // Game-Lobby-Layout
            if (this.elements.lobbySection) {
                this.elements.lobbySection.style.display = 'none';
                this.elements.lobbySection.classList.add('game-active');
            }
            
            if (this.elements.gameLobbySection) {
                this.elements.gameLobbySection.style.display = 'block';
                this.elements.gameLobbySection.classList.add('active');
            }
        }

        this.triggerLayoutEvent(layout);
        console.log(`✅ Layout set immediately: ${layout}`);
    }

    // Layout-Event auslösen
    triggerLayoutEvent(layout) {
        const event = new CustomEvent('layoutChanged', {
            detail: {
                layout: layout,
                timestamp: Date.now(),
                previousLayout: this.currentState
            }
        });
        
        window.dispatchEvent(event);
    }

    // Aktuelles Layout abrufen
    getCurrentLayout() {
        return this.currentState;
    }

    // Layout validieren
    validateLayout() {
        const validStates = ['default', 'game-lobby'];
        
        if (!validStates.includes(this.currentState)) {
            console.warn(`Invalid layout state: ${this.currentState}`);
            this.showDefaultLayout();
            return false;
        }
        
        return true;
    }

    // Debug-Informationen
    getDebugInfo() {
        return {
            currentState: this.currentState,
            elements: Object.keys(this.elements).reduce((info, key) => {
                info[key] = {
                    found: !!this.elements[key],
                    visible: this.elements[key] ? 
                        window.getComputedStyle(this.elements[key]).display !== 'none' : false
                };
                return info;
            }, {}),
            bodyClasses: document.body.className,
            timestamp: new Date().toISOString()
        };
    }

    // Layout-Reset (für Debugging)
    reset() {
        console.log('🔄 Resetting layout manager');
        
        // Alle Animationen stoppen
        Object.values(this.elements).forEach(element => {
            if (element) {
                element.style.animation = '';
            }
        });
        
        // Auf Standard zurücksetzen
        this.setLayoutImmediate('default');
        
        console.log('✅ Layout manager reset complete');
    }

    // Responsive Layout-Anpassungen
    handleResize() {
        const width = window.innerWidth;
        
        // Mobile Breakpoint
        if (width <= 768) {
            if (this.elements.lobbySection && this.currentState === 'default') {
                this.elements.lobbySection.style.gridTemplateColumns = '1fr';
                this.elements.lobbySection.style.gap = '1rem';
            }
        } else if (width <= 1024) {
            if (this.elements.lobbySection && this.currentState === 'default') {
                this.elements.lobbySection.style.gridTemplateColumns = '1fr';
                this.elements.lobbySection.style.gap = '1.5rem';
            }
        } else {
            if (this.elements.lobbySection && this.currentState === 'default') {
                this.elements.lobbySection.style.gridTemplateColumns = '1fr 1fr';
                this.elements.lobbySection.style.gap = '2rem';
            }
        }
    }
}

// Layout-Manager als globale Instanz
window.layoutManager = null;

// Initialisierung
document.addEventListener('DOMContentLoaded', () => {
    window.layoutManager = new LobbyLayoutManager();
    
    // Resize-Handler
    window.addEventListener('resize', () => {
        if (window.layoutManager) {
            window.layoutManager.handleResize();
        }
    });
    
    // Layout-Event-Listener für Debugging
    window.addEventListener('layoutChanged', (event) => {
        console.log('📐 Layout changed:', event.detail);
    });
    
    console.log('Layout Manager ready');
});

// Export für Module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LobbyLayoutManager;
}