// server/socketHandlers/gameHandlers.js
// Socket.IO Event Handler für Spielaktionen

const gameEngine = require('../controllers/gameEngine');
const db = require('../config/database');

// Game Socket Handlers
const setupGameHandlers = (io, socket) => {
    
    // Spielraum beitreten
    socket.on('join_db_game_room', async (data) => {
        try {
            console.log(`🎮 Player ${data.playerName} joining game room ${data.gameId}`);
            
            socket.join(`game_${data.gameId}`);
            socket.gameId = data.gameId;
            socket.playerName = data.playerName;
            
            // Spielerzuordnung finden
            const player = await db.query(
                'SELECT * FROM game_players WHERE game_id = ? AND player_name = ?',
                [data.gameId, data.playerName]
            );
            
            if (player.length > 0) {
                socket.playerId = player[0].id;
                console.log(`✅ Player ${data.playerName} joined game ${data.gameId}, playerId: ${socket.playerId}`);
            }
            
        } catch (error) {
            console.error('Error joining game room:', error);
            socket.emit('error', 'Fehler beim Beitreten des Spielraums');
        }
    });

    // Spielzustand anfordern
    socket.on('get_game_state', async (data) => {
        try {
            console.log(`📋 Game state requested for game ${data.gameId}`);
            
            const result = await gameEngine.loadGameState(data.gameId);
            
            if (result.success) {
                socket.emit('game_state', {
                    success: true,
                    gameId: data.gameId,
                    gameState: result.gameState
                });
                
                // Prüfe ob Spiel gerade gestartet wurde
                if (result.gameState.game.status === 'playing' && result.gameState.game.turn_number === 1) {
                    // Starte ersten Zug
                    await startPlayerTurn(io, data.gameId, result.gameState.game.current_turn_player_id);
                }
            } else {
                socket.emit('error', result.message);
            }
            
        } catch (error) {
            console.error('Error getting game state:', error);
            socket.emit('error', 'Fehler beim Laden des Spielzustands');
        }
    });

    // Einheit kaufen
    socket.on('buy_unit', async (data) => {
        try {
            console.log(`💰 Buy unit request:`, data);
            
            if (!socket.playerId) {
                socket.emit('error', 'Spieler nicht gefunden');
                return;
            }

            const result = await gameEngine.buyUnit(
                data.gameId,
                socket.playerId,
                data.cityX,
                data.cityY,
                data.unitId
            );

            if (result.success) {
                // Erfolg an alle Spieler im Raum
                io.to(`game_${data.gameId}`).emit('unit_bought', {
                    playerName: socket.playerName,
                    unitName: result.unitData.name,
                    cost: result.unitCost,
                    x: data.cityX,
                    y: data.cityY
                });
                
                // Aktualisierte Spieldaten senden
                await broadcastGameState(io, data.gameId);
                
                console.log(`✅ Unit bought by ${socket.playerName}`);
            } else {
                socket.emit('error', result.message);
            }
            
        } catch (error) {
            console.error('Error buying unit:', error);
            socket.emit('error', 'Fehler beim Einheitenkauf');
        }
    });

    // Einheit bewegen
    socket.on('move_unit', async (data) => {
        try {
            console.log(`🚶 Move unit request:`, data);
            
            if (!socket.playerId) {
                socket.emit('error', 'Spieler nicht gefunden');
                return;
            }

            const result = await gameEngine.moveUnit(
                data.gameId,
                socket.playerId,
                data.fromX,
                data.fromY,
                data.toX,
                data.toY,
                data.path
            );

            if (result.success) {
                // Bewegung an alle Spieler im Raum
                io.to(`game_${data.gameId}`).emit('unit_moved', {
                    playerName: socket.playerName,
                    fromX: data.fromX,
                    fromY: data.fromY,
                    toX: data.toX,
                    toY: data.toY
                });
                
                // Aktualisierte Spieldaten senden
                await broadcastGameState(io, data.gameId);
                
                console.log(`✅ Unit moved by ${socket.playerName}`);
            } else {
                socket.emit('error', result.message);
            }
            
        } catch (error) {
            console.error('Error moving unit:', error);
            socket.emit('error', 'Fehler bei der Bewegung');
        }
    });

    // Einheit angreifen
    socket.on('attack_unit', async (data) => {
        try {
            console.log(`⚔️ Attack unit request:`, data);
            
            if (!socket.playerId) {
                socket.emit('error', 'Spieler nicht gefunden');
                return;
            }

            const result = await gameEngine.attackUnit(
                data.gameId,
                socket.playerId,
                data.attackerX,
                data.attackerY,
                data.defenderX,
                data.defenderY
            );

            if (result.success) {
                // Angriff an alle Spieler im Raum
                io.to(`game_${data.gameId}`).emit('unit_attacked', {
                    playerName: socket.playerName,
                    damage: result.damage,
                    unitDestroyed: result.unitDestroyed,
                    defenderName: result.defenderName,
                    newHealth: result.newHealth
                });
                
                // Aktualisierte Spieldaten senden
                await broadcastGameState(io, data.gameId);
                
                console.log(`✅ Attack executed by ${socket.playerName}`);
            } else {
                socket.emit('error', result.message);
            }
            
        } catch (error) {
            console.error('Error attacking unit:', error);
            socket.emit('error', 'Fehler beim Angriff');
        }
    });

    // Rasse aufwerten
    socket.on('upgrade_race', async (data) => {
        try {
            console.log(`📈 Upgrade race request:`, data);
            
            if (!socket.playerId) {
                socket.emit('error', 'Spieler nicht gefunden');
                return;
            }

            const result = await gameEngine.upgradeRaceLevel(data.gameId, socket.playerId);

            if (result.success) {
                // Aufwertung an alle Spieler im Raum
                io.to(`game_${data.gameId}`).emit('race_upgraded', {
                    playerName: socket.playerName,
                    newLevel: result.newLevel,
                    cost: result.cost
                });
                
                // Aktualisierte Spieldaten senden
                await broadcastGameState(io, data.gameId);
                
                console.log(`✅ Race upgraded by ${socket.playerName} to level ${result.newLevel}`);
            } else {
                socket.emit('error', result.message);
            }
            
        } catch (error) {
            console.error('Error upgrading race:', error);
            socket.emit('error', 'Fehler beim Rassen-Aufstieg');
        }
    });

    // Zug beenden
    socket.on('end_turn', async (data) => {
        try {
            console.log(`🔄 End turn request by ${socket.playerName}`);
            
            if (!socket.playerId) {
                socket.emit('error', 'Spieler nicht gefunden');
                return;
            }

            const result = await gameEngine.endTurn(data.gameId, socket.playerId);

            if (result.success) {
                // Zug beendet an alle Spieler
                io.to(`game_${data.gameId}`).emit('turn_ended', {
                    playerName: socket.playerName,
                    nextPlayer: result.nextPlayer,
                    newTurnNumber: result.newTurnNumber
                });
                
                // Prüfe Spielende
                if (result.gameEnd && result.gameEnd.gameEnded) {
                    io.to(`game_${data.gameId}`).emit('game_ended', {
                        winner: result.gameEnd.winner
                    });
                } else {
                    // Nächsten Zug starten
                    await startPlayerTurn(io, data.gameId, result.nextPlayer.id);
                }
                
                // Aktualisierte Spieldaten senden
                await broadcastGameState(io, data.gameId);
                
                console.log(`✅ Turn ended by ${socket.playerName}, next: ${result.nextPlayer.player_name}`);
            } else {
                socket.emit('error', result.message);
            }
            
        } catch (error) {
            console.error('Error ending turn:', error);
            socket.emit('error', 'Fehler beim Zug beenden');
        }
    });

    // Verfügbare Einheiten einer Rasse abrufen
    socket.on('get_race_units', async (data) => {
        try {
            console.log(`🏷️ Get race units for race ${data.raceId}`);
            
            const units = await db.query(
                'SELECT * FROM units WHERE race_id = ? ORDER BY cost, name',
                [data.raceId]
            );
            
            socket.emit('race_units', {
                raceId: data.raceId,
                units: units
            });
            
        } catch (error) {
            console.error('Error getting race units:', error);
            socket.emit('error', 'Fehler beim Laden der Einheiten');
        }
    });

    // Spiel verlassen
    socket.on('leave_game', async (data) => {
        try {
            console.log(`🚪 Player ${socket.playerName} leaving game ${data.gameId}`);
            
            if (socket.gameId) {
                socket.leave(`game_${socket.gameId}`);
                
                // Spieler als inaktiv markieren
                if (socket.playerId) {
                    await db.query(
                        'UPDATE game_players SET is_active = 0 WHERE id = ?',
                        [socket.playerId]
                    );
                }
                
                // Anderen Spielern mitteilen
                socket.to(`game_${socket.gameId}`).emit('player_left', {
                    playerName: socket.playerName,
                    playerId: socket.playerId
                });
                
                // Spiel-Socket-Daten löschen
                socket.gameId = null;
                socket.playerId = null;
                socket.playerName = null;
            }
            
        } catch (error) {
            console.error('Error leaving game:', error);
        }
    });

    // Reconnection Handler
    socket.on('rejoin_game', async (data) => {
        try {
            console.log(`🔄 Player ${data.playerName} rejoining game ${data.gameId}`);
            
            socket.join(`game_${data.gameId}`);
            socket.gameId = data.gameId;
            socket.playerName = data.playerName;
            
            // Spieler ID finden
            const player = await db.query(
                'SELECT * FROM game_players WHERE game_id = ? AND player_name = ?',
                [data.gameId, data.playerName]
            );
            
            if (player.length > 0) {
                socket.playerId = player[0].id;
                
                // Als aktiv markieren
                await db.query(
                    'UPDATE game_players SET is_active = 1 WHERE id = ?',
                    [socket.playerId]
                );
                
                // Aktuellen Spielzustand senden
                const result = await gameEngine.loadGameState(data.gameId);
                if (result.success) {
                    socket.emit('game_state', {
                        success: true,
                        gameId: data.gameId,
                        gameState: result.gameState
                    });
                }
                
                console.log(`✅ Player ${data.playerName} rejoined successfully`);
            }
            
        } catch (error) {
            console.error('Error rejoining game:', error);
            socket.emit('error', 'Fehler beim Wiederverbinden');
        }
    });
};

// Hilfsfunktionen

// Spielerzug starten
async function startPlayerTurn(io, gameId, playerId) {
    try {
        console.log(`🎯 Starting turn for player ${playerId} in game ${gameId}`);
        
        const result = await gameEngine.startPlayerTurn(gameId, playerId);
        
        if (result.success) {
            // Spieler-Information für Benachrichtigung
            const player = await db.query(
                'SELECT player_name FROM game_players WHERE id = ?',
                [playerId]
            );
            
            if (player.length > 0) {
                io.to(`game_${gameId}`).emit('turn_started', {
                    playerId: playerId,
                    playerName: player[0].player_name,
                    goldIncome: result.goldIncome
                });
                
                console.log(`✅ Turn started for ${player[0].player_name}, +${result.goldIncome} gold`);
            }
        }
        
    } catch (error) {
        console.error('Error starting player turn:', error);
    }
}

// Spielzustand an alle Spieler senden
async function broadcastGameState(io, gameId) {
    try {
        const result = await gameEngine.loadGameState(gameId);
        
        if (result.success) {
            io.to(`game_${gameId}`).emit('game_state', {
                success: true,
                gameId: gameId,
                gameState: result.gameState
            });
        }
        
    } catch (error) {
        console.error('Error broadcasting game state:', error);
    }
}

// Spiel nach Rassenauswahl starten
async function startGameAfterRaceSelection(io, gameId) {
    try {
        console.log(`🚀 Starting game ${gameId} after race selection`);
        
        const result = await gameEngine.startGame(gameId);
        
        if (result.success) {
            // Spielzustand an alle senden
            await broadcastGameState(io, gameId);
            
            // Ersten Zug starten
            await startPlayerTurn(io, gameId, result.firstPlayerId);
            
            console.log(`✅ Game ${gameId} started successfully`);
        } else {
            console.error('Failed to start game:', result.message);
        }
        
    } catch (error) {
        console.error('Error starting game after race selection:', error);
    }
}

module.exports = {
    setupGameHandlers,
    startGameAfterRaceSelection,
    broadcastGameState,
    startPlayerTurn
};