// Verbesserte Layout Manager für das Strategiespiel - lobby_layout_manager.js

class LobbyLayoutManager {
    constructor() {
        this.currentState = 'default'; // 'default' | 'game-lobby'
        this.animationDuration = 500; // Längere Animation für stabilere Transitions
        this.isTransitioning = false; // Verhindert mehrfache gleichzeitige Transitions
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
        this.setupEventListeners();
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

    setupEventListeners() {
        // Verhindere Layout-Änderungen während Transitions
        window.addEventListener('beforeunload', () => {
            this.isTransitioning = false;
        });
    }

    setInitialState() {
        console.log('🎯 Setting initial layout state');
        
        // Forciere korrekten Initialzustand
        if (this.elements.lobbySection) {
            this.elements.lobbySection.style.display = 'grid';
            this.elements.lobbySection.style.gridTemplateColumns = '1fr 1fr';
            this.elements.lobbySection.style.gap = '2rem';
            this.elements.lobbySection.style.visibility = 'visible';
            this.elements.lobbySection.style.opacity = '1';
            this.elements.lobbySection.classList.remove('game-active');
            this.elements.lobbySection.classList.add('show-grid');
        }
        
        if (this.elements.gameLobbySection) {
            this.elements.gameLobbySection.style.display = 'none';
            this.elements.gameLobbySection.style.visibility = 'hidden';
            this.elements.gameLobbySection.style.opacity = '0';
            this.elements.gameLobbySection.classList.remove('active');
        }
        
        // Body-Klasse setzen
        document.body.className = document.body.className.replace(/layout-state-\w+/g, '');
        document.body.classList.add('layout-state-default');
        
        this.currentState = 'default';
        console.log('✅ Initial layout state set to default');
    }

    // Standard-Layout anzeigen (Spiel erstellen + Verfügbare Spiele)
    showDefaultLayout() {
        console.log('🎯 Switching to default layout');
        
        if (this.currentState === 'default' && !this.isTransitioning) {
            console.log('Already in default layout and not transitioning');
            return;
        }

        if (this.isTransitioning) {
            console.log('Layout transition in progress, queuing default layout');
            setTimeout(() => this.showDefaultLayout(), 100);
            return;
        }

        this.isTransitioning = true;
        this.currentState = 'default';
        
        console.log('🔄 Starting transition to default layout');
        
        // Body-Klasse für CSS-State setzen
        document.body.className = document.body.className.replace(/layout-state-\w+/g, '');
        document.body.classList.add('layout-state-default');

        // Schritt 1: Game Lobby ausblenden
        if (this.elements.gameLobbySection) {
            console.log('📴 Hiding game lobby section');
            this.elements.gameLobbySection.style.transition = 'opacity 0.3s ease-out, visibility 0.3s ease-out';
            this.elements.gameLobbySection.style.opacity = '0';
            this.elements.gameLobbySection.style.visibility = 'hidden';
            
            setTimeout(() => {
                if (this.elements.gameLobbySection) {
                    this.elements.gameLobbySection.style.display = 'none';
                    this.elements.gameLobbySection.classList.remove('active');
                    console.log('✅ Game lobby section hidden');
                }
            }, 300);
        }

        // Schritt 2: Lobby Section einblenden (nach kurzer Verzögerung)
        setTimeout(() => {
            if (this.elements.lobbySection) {
                console.log('📱 Showing lobby sections');
                
                // Display und Grid-Layout setzen
                this.elements.lobbySection.style.display = 'grid';
                this.elements.lobbySection.style.gridTemplateColumns = '1fr 1fr';
                this.elements.lobbySection.style.gap = '2rem';
                this.elements.lobbySection.classList.remove('game-active');
                this.elements.lobbySection.classList.add('show-grid');
                
                // Sichtbarkeit mit Transition
                this.elements.lobbySection.style.transition = 'opacity 0.4s ease-in, visibility 0.4s ease-in';
                this.elements.lobbySection.style.visibility = 'visible';
                this.elements.lobbySection.style.opacity = '1';
                
                console.log('✅ Lobby sections shown');
            }
            
            // Player Section wieder anzeigen falls versteckt
            if (this.elements.playerSection) {
                this.elements.playerSection.style.display = 'block';
                this.elements.playerSection.style.visibility = 'visible';
            }
            
            // Transition beenden
            setTimeout(() => {
                this.isTransitioning = false;
                this.triggerLayoutEvent('default');
                console.log('✅ Default layout transition completed');
            }, 400);
            
        }, 150); // Kurze Verzögerung für smoother Transition
    }

    // Game-Lobby-Layout anzeigen
    showGameLobbyLayout() {
        console.log('🎯 Switching to game lobby layout');
        
        if (this.currentState === 'game-lobby' && !this.isTransitioning) {
            console.log('Already in game lobby layout and not transitioning');
            return;
        }

        if (this.isTransitioning) {
            console.log('Layout transition in progress, queuing game lobby layout');
            setTimeout(() => this.showGameLobbyLayout(), 100);
            return;
        }

        this.isTransitioning = true;
        this.currentState = 'game-lobby';
        
        console.log('🔄 Starting transition to game lobby layout');
        
        // Body-Klasse für CSS-State setzen
        document.body.className = document.body.className.replace(/layout-state-\w+/g, '');
        document.body.classList.add('layout-state-game-lobby');

        // Schritt 1: Lobby Section ausblenden
        if (this.elements.lobbySection) {
            console.log('📴 Hiding lobby sections');
            this.elements.lobbySection.style.transition = 'opacity 0.3s ease-out, visibility 0.3s ease-out';
            this.elements.lobbySection.style.opacity = '0';
            this.elements.lobbySection.style.visibility = 'hidden';
            
            setTimeout(() => {
                if (this.elements.lobbySection) {
                    this.elements.lobbySection.style.display = 'none';
                    this.elements.lobbySection.classList.add('game-active');
                    this.elements.lobbySection.classList.remove('show-grid');
                    console.log('✅ Lobby sections hidden');
                }
            }, 300);
        }

        // Schritt 2: Game Lobby einblenden (nach kurzer Verzögerung)
        setTimeout(() => {
            if (this.elements.gameLobbySection) {
                console.log('📱 Showing game lobby section');
                
                // Display setzen
                this.elements.gameLobbySection.style.display = 'block';
                this.elements.gameLobbySection.classList.add('active');
                
                // Sichtbarkeit mit Transition
                this.elements.gameLobbySection.style.transition = 'opacity 0.4s ease-in, visibility 0.4s ease-in';
                this.elements.gameLobbySection.style.visibility = 'visible';
                this.elements.gameLobbySection.style.opacity = '1';
                
                console.log('✅ Game lobby section shown');
            }
            
            // Transition beenden
            setTimeout(() => {
                this.isTransitioning = false;
                this.triggerLayoutEvent('game-lobby');
                console.log('✅ Game lobby layout transition completed');
            }, 400);
            
        }, 150); // Kurze Verzögerung für smoother Transition
    }

    // Layout sofort ohne Animation wechseln (für Debugging/Fallback)
    setLayoutImmediate(layout) {
        console.log(`🚀 Setting layout immediately: ${layout}`);
        
        this.isTransitioning = false; // Reset transition state
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
                this.elements.lobbySection.style.visibility = 'visible';
                this.elements.lobbySection.style.opacity = '1';
                this.elements.lobbySection.classList.remove('game-active');
                this.elements.lobbySection.classList.add('show-grid');
            }
            
            if (this.elements.gameLobbySection) {
                this.elements.gameLobbySection.style.display = 'none';
                this.elements.gameLobbySection.style.visibility = 'hidden';
                this.elements.gameLobbySection.style.opacity = '0';
                this.elements.gameLobbySection.classList.remove('active');
            }
            
            if (this.elements.playerSection) {
                this.elements.playerSection.style.display = 'block';
                this.elements.playerSection.style.visibility = 'visible';
            }
            
        } else if (layout === 'game-lobby') {
            // Game-Lobby-Layout
            if (this.elements.lobbySection) {
                this.elements.lobbySection.style.display = 'none';
                this.elements.lobbySection.style.visibility = 'hidden';
                this.elements.lobbySection.style.opacity = '0';
                this.elements.lobbySection.classList.add('game-active');
                this.elements.lobbySection.classList.remove('show-grid');
            }
            
            if (this.elements.gameLobbySection) {
                this.elements.gameLobbySection.style.display = 'block';
                this.elements.gameLobbySection.style.visibility = 'visible';
                this.elements.gameLobbySection.style.opacity = '1';
                this.elements.gameLobbySection.classList.add('active');
            }
        }

        this.triggerLayoutEvent(layout);
        console.log(`✅ Layout set immediately to: ${layout}`);
    }

    // Event für Layout-Änderungen
    triggerLayoutEvent(layout) {
        const event = new CustomEvent('layoutChanged', {
            detail: { 
                layout: layout,
                timestamp: Date.now(),
                isTransitioning: this.isTransitioning
            }
        });
        window.dispatchEvent(event);
    }

    // Debug-Information
    getDebugInfo() {
        return {
            currentState: this.currentState,
            isTransitioning: this.isTransitioning,
            animationDuration: this.animationDuration,
            elements: Object.keys(this.elements).reduce((info, key) => {
                info[key] = {
                    found: !!this.elements[key],
                    display: this.elements[key] ? this.elements[key].style.display : 'not found',
                    visibility: this.elements[key] ? this.elements[key].style.visibility : 'not found',
                    opacity: this.elements[key] ? this.elements[key].style.opacity : 'not found',
                    missing: !this.elements[key],
                    visible: this.elements[key] ? 
                        (window.getComputedStyle(this.elements[key]).display !== 'none' &&
                         window.getComputedStyle(this.elements[key]).visibility !== 'hidden') : false
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
        
        // Transition stoppen
        this.isTransitioning = false;
        
        // Alle Animationen und Transitions stoppen
        Object.values(this.elements).forEach(element => {
            if (element) {
                element.style.animation = '';
                element.style.transition = '';
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

    // Force Layout Update (wenn Elemente stuck sind)
    forceLayoutUpdate() {
        console.log('🔧 Forcing layout update...');
        
        const currentLayout = this.currentState;
        this.isTransitioning = false;
        
        // Kurz auf anderen State wechseln und zurück
        if (currentLayout === 'default') {
            this.setLayoutImmediate('game-lobby');
            setTimeout(() => {
                this.setLayoutImmediate('default');
                console.log('✅ Layout force update completed');
            }, 50);
        } else {
            this.setLayoutImmediate('default');
            setTimeout(() => {
                this.setLayoutImmediate('game-lobby');
                console.log('✅ Layout force update completed');
            }, 50);
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
    
    // Globale Debug-Funktionen
    window.debugLayout = () => {
        if (window.layoutManager) {
            console.table(window.layoutManager.getDebugInfo());
        }
    };
    
    window.resetLayout = () => {
        if (window.layoutManager) {
            window.layoutManager.reset();
        }
    };
    
    window.forceLayoutUpdate = () => {
        if (window.layoutManager) {
            window.layoutManager.forceLayoutUpdate();
        }
    };
    
    console.log('Layout Manager ready');
});

// Export für Module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LobbyLayoutManager;
}