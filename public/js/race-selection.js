// Race Selection Client-Side Logic

class RaceSelectionManager {
    constructor() {
        this.socket = io();
        this.gameId = null;
        this.playerName = null;
        this.availableRaces = [];
        this.selectedRaceId = null;
        this.isConfirmed = false;
        this.playerSelections = {};
        
        this.initializeEventListeners();
        this.connectToServer();
    }

    connectToServer() {
        // Get game info from URL parameters or localStorage
        const urlParams = new URLSearchParams(window.location.search);
        this.gameId = urlParams.get('gameId') || localStorage.getItem('currentGameId');
        this.playerName = urlParams.get('playerName') || localStorage.getItem('playerName');

        if (!this.gameId || !this.playerName) {
            alert('Keine gültigen Spieldaten gefunden!');
            window.location.href = 'index.html';
            return;
        }

        // Update UI with player info
        document.getElementById('playerName').textContent = `Spieler: ${this.playerName}`;

        // Join race selection
        this.socket.emit('join-race-selection', { gameId: this.gameId, playerName: this.playerName });
    }

    initializeEventListeners() {
        // Socket event listeners
        this.socket.on('race-selection-joined', (data) => {
            console.log('Joined race selection:', data);
            this.updateGameInfo(data.game);
            this.loadAvailableRaces();
        });

        this.socket.on('available-races', (races) => {
            console.log('Received races:', races);
            this.availableRaces = races;
            this.renderRaces();
        });

        this.socket.on('race-selection-update', (data) => {
            console.log('Race selection update:', data);
            this.updatePlayerSelections(data.selections);
            this.updateReadyCount(data.readyCount, data.totalPlayers);
        });

        this.socket.on('race-selected', (data) => {
            console.log('Race selected:', data);
            if (data.success) {
                this.selectedRaceId = data.raceId;
                this.isConfirmed = false;
                this.updateSelectionUI();
                this.updateSelectionStatus('Rasse ausgewählt - noch nicht bestätigt');
            } else {
                alert(data.message || 'Fehler bei der Rassenauswahl');
            }
        });

        this.socket.on('race-confirmed', (data) => {
            console.log('Race confirmed:', data);
            if (data.success) {
                this.isConfirmed = true;
                this.updateSelectionUI();
                this.updateSelectionStatus('Rasse bestätigt - warten auf andere Spieler');
                this.showWaitingArea();
            } else {
                alert(data.message || 'Fehler bei der Rassenbestätigung');
            }
        });

        this.socket.on('race-deselected', (data) => {
            console.log('Race deselected:', data);
            if (data.success) {
                this.selectedRaceId = null;
                this.isConfirmed = false;
                this.updateSelectionUI();
                this.updateSelectionStatus('Keine Rasse ausgewählt');
                this.hideWaitingArea();
            } else {
                alert(data.message || 'Fehler beim Zurücksetzen der Auswahl');
            }
        });

        this.socket.on('all-races-selected', () => {
            console.log('All races selected, starting map generation...');
            this.updateSelectionStatus('Alle Spieler bereit - Karte wird generiert...');
            // Redirect will be handled by server or another event
        });

        this.socket.on('game-started', (data) => {
            console.log('Game started, redirecting to game...');
            localStorage.setItem('currentGameId', this.gameId);
            localStorage.setItem('playerName', this.playerName);
            window.location.href = `game.html?gameId=${this.gameId}&playerName=${this.playerName}`;
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            alert(error.message || 'Verbindungsfehler aufgetreten');
        });

        // UI event listeners
        document.getElementById('confirmBtn').addEventListener('click', () => {
            this.confirmRaceSelection();
        });

        document.getElementById('changeBtn').addEventListener('click', () => {
            this.changeRaceSelection();
        });

        document.getElementById('backBtn').addEventListener('click', () => {
            this.goBackToLobby();
        });

        // Modal event listeners
        const modal = document.getElementById('raceDetailsModal');
        const closeBtn = modal.querySelector('.close');
        
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        window.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    loadAvailableRaces() {
        this.socket.emit('get-available-races', { gameId: this.gameId });
    }

    renderRaces() {
        const racesGrid = document.getElementById('racesGrid');
        racesGrid.innerHTML = '';

        if (this.availableRaces.length === 0) {
            racesGrid.innerHTML = '<p class="no-races">Keine Rassen verfügbar</p>';
            return;
        }

        this.availableRaces.forEach(race => {
            const raceCard = this.createRaceCard(race);
            racesGrid.appendChild(raceCard);
        });
    }

    createRaceCard(race) {
        const card = document.createElement('div');
        card.className = 'race-card';
        card.dataset.raceId = race.id;

        if (this.selectedRaceId === race.id) {
            card.classList.add(this.isConfirmed ? 'confirmed' : 'selected');
        }

        card.innerHTML = `
            <div class="race-header">
                <div class="race-color" style="background-color: ${race.color_hex}"></div>
                <div class="race-name">${race.name}</div>
            </div>
            <div class="race-description">${race.description || 'Keine Beschreibung verfügbar'}</div>
            <div class="race-stats">
                <span class="unit-count">${race.unit_count || 10} Einheiten</span>
                <a href="#" class="view-details" data-race-id="${race.id}">Details ansehen</a>
            </div>
        `;

        // Add click event for race selection
        card.addEventListener('click', (e) => {
            e.preventDefault();
            if (!this.isConfirmed) {
                this.selectRace(race.id);
            }
        });

        // Add click event for details
        const detailsLink = card.querySelector('.view-details');
        detailsLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showRaceDetails(race.id);
        });

        return card;
    }

    selectRace(raceId) {
        if (this.isConfirmed) {
            alert('Du hast deine Rasse bereits bestätigt. Klicke auf "Rasse ändern" um eine neue auszuwählen.');
            return;
        }

        console.log('Selecting race:', raceId);
        this.socket.emit('select-race', {
            gameId: this.gameId,
            playerName: this.playerName,
            raceId: raceId
        });
    }

    confirmRaceSelection() {
        if (!this.selectedRaceId) {
            alert('Bitte wähle zuerst eine Rasse aus!');
            return;
        }

        if (this.isConfirmed) {
            alert('Du hast deine Rasse bereits bestätigt!');
            return;
        }

        console.log('Confirming race selection:', this.selectedRaceId);
        this.socket.emit('confirm-race', {
            gameId: this.gameId,
            playerName: this.playerName
        });
    }

    changeRaceSelection() {
        if (!this.isConfirmed) {
            alert('Du kannst deine Auswahl noch ändern, da sie nicht bestätigt ist.');
            return;
        }

        const confirmChange = confirm('Möchtest du deine bestätigte Rassenauswahl wirklich ändern?');
        if (confirmChange) {
            console.log('Deselecting race to allow change');
            this.socket.emit('deselect-race', {
                gameId: this.gameId,
                playerName: this.playerName
            });
        }
    }

    goBackToLobby() {
        if (this.isConfirmed) {
            const confirmLeave = confirm('Du hast bereits eine Rasse bestätigt. Möchtest du wirklich zur Lobby zurückkehren?');
            if (!confirmLeave) return;
        }

        // Deselect race if selected
        if (this.selectedRaceId) {
            this.socket.emit('deselect-race', {
                gameId: this.gameId,
                playerName: this.playerName
            });
        }

        // Go back to lobby
        window.location.href = `lobby.html?gameId=${this.gameId}&playerName=${this.playerName}`;
    }

    showRaceDetails(raceId) {
        const race = this.availableRaces.find(r => r.id === raceId);
        if (!race) return;

        // Load race units and show in modal
        this.socket.emit('get-race-details', { raceId: raceId });
        
        this.socket.once('race-details', (data) => {
            if (data.success) {
                this.displayRaceDetailsModal(race, data.units);
            } else {
                alert('Fehler beim Laden der Rassendetails');
            }
        });
    }

    displayRaceDetailsModal(race, units) {
        const modal = document.getElementById('raceDetailsModal');
        const content = document.getElementById('raceDetailsContent');

        let unitsHtml = '';
        if (units && units.length > 0) {
            unitsHtml = `
                <h3>Verfügbare Einheiten</h3>
                <div class="units-list">
                    ${units.map(unit => `
                        <div class="unit-card">
                            <h4>${unit.name}</h4>
                            <div class="unit-stats">
                                <span>Kosten: ${unit.cost} Gold</span>
                                <span>Angriff: ${unit.attack_power}</span>
                                <span>Leben: ${unit.health}</span>
                                <span>Bewegung: ${unit.movement_points}</span>
                                <span>Reichweite: ${unit.attack_range}</span>
                            </div>
                            <p class="unit-description">${unit.description || 'Keine Beschreibung'}</p>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        content.innerHTML = `
            <div class="race-details">
                <div class="race-header-modal">
                    <div class="race-color-large" style="background-color: ${race.color_hex}"></div>
                    <h2>${race.name}</h2>
                </div>
                <p class="race-description-modal">${race.description || 'Keine Beschreibung verfügbar'}</p>
                ${unitsHtml}
            </div>
        `;

        modal.style.display = 'block';
    }

    updateSelectionUI() {
        // Update race card visuals
        document.querySelectorAll('.race-card').forEach(card => {
            card.classList.remove('selected', 'confirmed');
            const raceId = parseInt(card.dataset.raceId);
            
            if (this.selectedRaceId === raceId) {
                card.classList.add(this.isConfirmed ? 'confirmed' : 'selected');
            }
        });

        // Update buttons
        const confirmBtn = document.getElementById('confirmBtn');
        const changeBtn = document.getElementById('changeBtn');

        if (this.isConfirmed) {
            confirmBtn.style.display = 'none';
            changeBtn.style.display = 'inline-block';
        } else {
            confirmBtn.style.display = 'inline-block';
            confirmBtn.disabled = !this.selectedRaceId;
            changeBtn.style.display = 'none';
        }
    }

    updateSelectionStatus(status) {
        document.getElementById('selectionStatus').textContent = status;
    }

    updateGameInfo(game) {
        document.getElementById('gameInfo').textContent = `Spiel: ${game.name} (${game.map_size}x${game.map_size})`;
    }

    updatePlayerSelections(selections) {
        this.playerSelections = selections;
        // Note: We don't show other players' selections to maintain secrecy
    }

    updateReadyCount(readyCount, totalPlayers) {
        document.getElementById('playersReady').textContent = readyCount;
        document.getElementById('totalPlayers').textContent = totalPlayers;
    }

    showWaitingArea() {
        document.getElementById('waitingArea').style.display = 'block';
    }

    hideWaitingArea() {
        document.getElementById('waitingArea').style.display = 'none';
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new RaceSelectionManager();
});

// Handle browser back/forward buttons
window.addEventListener('beforeunload', (e) => {
    // Warn if player has made a selection
    const manager = window.raceSelectionManager;
    if (manager && manager.selectedRaceId && !manager.isConfirmed) {
        e.preventDefault();
        e.returnValue = 'Du hast eine Rasse ausgewählt aber noch nicht bestätigt. Möchtest du die Seite wirklich verlassen?';
    }
});