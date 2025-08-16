// Game JavaScript - Frontend logic for the main game

class GameManager {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.gameState = null;
        this.playerName = '';
        this.currentPlayer = null;
        this.selectedUnit = null;
        this.selectedBuilding = null;
        
        // Canvas and rendering
        this.canvas = null;
        this.ctx = null;
        this.minimap = null;
        this.minimapCtx = null;
        
        // Map rendering settings
        this.tileSize = 32;
        this.mapOffsetX = 0;
        this.mapOffsetY = 0;
        this.zoom = 1;
        this.minZoom = 0.5;
        this.maxZoom = 2;
        
        // Mouse interaction
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.hoveredTile = null;
        
        this.init();
    }

    init() {
        this.gameId = getGameIdFromUrl();
        if (!this.gameId) {
            showNotification('Keine gültige Spiel-ID gefunden', 'error');
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }

        this.playerName = loadFromLocalStorage('playerName', '');
        if (!this.playerName) {
            showNotification('Kein Spielername gefunden', 'error');
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }

        this.setupCanvas();
        this.setupSocket();
        this.setupEventListeners();
        this.showLoadingScreen('Verbinde mit Spiel...');
    }

    setupCanvas() {
        this.canvas = document.getElementById('gameMap');
        this.ctx = this.canvas.getContext('2d');
        
        this.minimap = document.getElementById('minimap');
        this.minimapCtx = this.minimap.getContext('2d');
        
        // Set canvas size to container
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight - 100; // Account for controls
        
        if (this.gameState) {
            this.renderMap();
        }
    }

    setupSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to game server');
            this.joinGame();
        });

        this.socket.on('disconnect', () => {
            showNotification('Verbindung zum Server verloren', 'error');
        });

        this.socket.on('game_state', (gameState) => {
            this.updateGameState(gameState);
            this.hideLoadingScreen();
        });

        this.socket.on('error', (error) => {
            showNotification(error, 'error');
        });

        // Game events would be handled here
        this.socket.on('turn_ended', (data) => {
            this.handleTurnEnd(data);
        });

        this.socket.on('unit_moved', (data) => {
            this.handleUnitMove(data);
        });

        this.socket.on('battle_result', (data) => {
            this.handleBattleResult(data);
        });
    }

    setupEventListeners() {
        // Canvas mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // UI buttons
        document.getElementById('endTurnBtn').addEventListener('click', () => this.endTurn());
        document.getElementById('leaveGame