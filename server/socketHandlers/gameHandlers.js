// server/socketHandlers/gameHandlers.js
// Socket-Handler für Spielfunktionen

const gameEngine = require('../controllers/gameEngine');
const turnManager = require('../controllers/turnManager');
const db = require('../config/database');

class GameHandlers {
    constructor(io) {
        this.io = io;
        this.gameRooms = new Map(); // gameId -> Set of socketIds
        this.playerSockets = new Map(); // socketId -> {gameId, playerId, playerName}
    }

    // Spieler tritt Spiel-Room bei
    async handleJoinGameRoom(socket, data) {
        try {
            const { gameId, playerName } = data;
            
            console.log(`⚔️ Player ${playerInfo.playerName} attacking with unit ${attackerUnitId} at (${targetX}, ${targetY})`);

            const result = await turnManager.attackUnit(gameId, playerInfo.playerId, attackerUnitId, targetX, targetY);

            // Ergebnis an Spieler senden
            socket.emit('unit_attacked', result);

            // Bei Erfolg alle Spieler informieren
            if (result.success) {
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: await this.getGameState(gameId)
                });

                // Battle-Nachricht an alle Spieler
                this.io.to(`game_${gameId}`).emit('battle_result', {
                    attackerName: result.attackerName,
                    targetName: result.targetName,
                    targetPlayer: result.targetPlayer,
                    damage: result.damage,
                    targetDestroyed: result.targetDestroyed,
                    attackerPlayer: playerInfo.playerName
                });

                // Prüfe Spielende
                const gameEndResult = await turnManager.checkGameEnd(gameId);
                if (gameEndResult.gameEnded) {
                    this.io.to(`game_${gameId}`).emit('game_ended', {
                        winner: gameEndResult.winner,
                        message: gameEndResult.winner 
                            ? `${gameEndResult.winner.player_name} hat gewonnen!` 
                            : 'Spiel beendet - Unentschieden'
                    });
                }
            }

        } catch (error) {
            console.error('Error handling attack unit:', error);
            socket.emit('unit_attacked', { success: false, message: 'Fehler beim Angriff' });
        }
    }

    // Einheit kaufen
    async handleBuyUnit(socket, data) {
        try {
            const { gameId, buildingX, buildingY, unitId } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            console.log(`💰 Player ${playerInfo.playerName} buying unit ${unitId} at (${buildingX}, ${buildingY})`);

            const result = await turnManager.buyUnit(gameId, playerInfo.playerId, buildingX, buildingY, unitId);

            // Ergebnis an Spieler senden
            socket.emit('unit_purchased', result);

            // Bei Erfolg alle Spieler informieren
            if (result.success) {
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: await this.getGameState(gameId)
                });

                socket.to(`game_${gameId}`).emit('unit_purchased', {
                    success: true,
                    playerName: playerInfo.playerName,
                    unitName: result.unitName,
                    buildingX: buildingX,
                    buildingY: buildingY
                });
            }

        } catch (error) {
            console.error('Error handling buy unit:', error);
            socket.emit('unit_purchased', { success: false, message: 'Fehler beim Einheitenkauf' });
        }
    }

    // Spieler-Level erhöhen
    async handleUpgradeLevel(socket, data) {
        try {
            const { gameId } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            console.log(`⬆️ Player ${playerInfo.playerName} upgrading level`);

            const result = await turnManager.upgradePlayerLevel(gameId, playerInfo.playerId);

            // Ergebnis senden
            socket.emit('action_result', result);

            // Bei Erfolg Spielzustand aktualisieren
            if (result.success) {
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: await this.getGameState(gameId)
                });

                socket.to(`game_${gameId}`).emit('player_leveled_up', {
                    playerName: playerInfo.playerName,
                    newLevel: result.newLevel
                });
            }

        } catch (error) {
            console.error('Error handling upgrade level:', error);
            socket.emit('action_result', { success: false, message: 'Fehler beim Stufenaufstieg' });
        }
    }

    // Zug beenden
    async handleEndTurn(socket, data) {
        try {
            const { gameId } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            console.log(`🔄 Player ${playerInfo.playerName} ending turn`);

            const result = await turnManager.endTurn(gameId, playerInfo.playerId);

            if (result.success) {
                // Aktueller Spieler - Zug beendet
                socket.emit('turn_ended', {
                    success: true,
                    nextPlayerName: result.nextPlayerName,
                    turnNumber: result.turnNumber
                });

                // Alle anderen Spieler - neuer Zug
                socket.to(`game_${gameId}`).emit('turn_ended', {
                    success: true,
                    nextPlayerName: result.nextPlayerName,
                    turnNumber: result.turnNumber
                });

                // Neuer Spielzustand für alle
                const gameState = await this.getGameState(gameId);
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: gameState
                });

                // Nächsten Spieler über seinen Zug informieren
                await this.notifyPlayerTurn(gameId, result.nextPlayerId, result.nextPlayerName);

            } else {
                socket.emit('turn_ended', result);
            }

        } catch (error) {
            console.error('Error handling end turn:', error);
            socket.emit('turn_ended', { success: false, message: 'Fehler beim Zugwechsel' });
        }
    }

    // Spieler über seinen Zug benachrichtigen
    async notifyPlayerTurn(gameId, playerId, playerName) {
        try {
            // Gold-Einkommen starten
            const turnResult = await turnManager.startTurn(gameId, playerId);

            // Allen Spielern mitteilen wer am Zug ist
            this.io.to(`game_${gameId}`).emit('turn_started', {
                currentPlayerId: playerId,
                currentPlayerName: playerName,
                turnNumber: turnResult.turnNumber || 1,
                goldIncome: turnResult.goldIncome || 0
            });

            // Spezifische Nachricht an den Spieler am Zug
            const playerSockets = Array.from(this.playerSockets.entries())
                .filter(([socketId, info]) => info.gameId === gameId && info.playerId === playerId)
                .map(([socketId]) => socketId);

            playerSockets.forEach(socketId => {
                const socket = this.io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.emit('turn_started', {
                        isMyTurn: true,
                        goldIncome: turnResult.goldIncome,
                        message: turnResult.message
                    });
                }
            });

        } catch (error) {
            console.error('Error notifying player turn:', error);
        }
    }

    // Verfügbare Einheiten für Kauf abrufen
    async handleGetAvailableUnits(socket, data) {
        try {
            const { gameId } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            // Lade verfügbare Einheiten für die Rasse des Spielers
            const units = await db.query(`
                SELECT u.*, gp.gold as player_gold, gp.player_level
                FROM units u, game_players gp
                WHERE gp.game_id = ? AND gp.id = ? AND u.race_id = gp.race_id
                ORDER BY u.cost, u.name
            `, [gameId, playerInfo.playerId]);

            socket.emit('available_units', {
                units: units,
                playerId: playerInfo.playerId
            });

        } catch (error) {
            console.error('Error getting available units:', error);
            socket.emit('error', { message: 'Fehler beim Laden der verfügbaren Einheiten' });
        }
    }

    // Socket Disconnect Handler
    handleDisconnect(socket) {
        const playerInfo = this.playerSockets.get(socket.id);
        
        if (playerInfo) {
            const { gameId, playerName } = playerInfo;
            
            console.log(`🚪 Player ${playerName} disconnected from game ${gameId}`);

            // Aus Room-Verwaltung entfernen
            if (this.gameRooms.has(gameId)) {
                this.gameRooms.get(gameId).delete(socket.id);
                
                // Wenn Room leer, aufräumen
                if (this.gameRooms.get(gameId).size === 0) {
                    this.gameRooms.delete(gameId);
                }
            }

            // Socket-Mapping entfernen
            this.playerSockets.delete(socket.id);

            // Andere Spieler benachrichtigen
            socket.to(`game_${gameId}`).emit('player_disconnected', {
                playerName: playerName,
                message: `${playerName} hat die Verbindung verloren`
            });
        }
    }

    // Hilfsmethoden
    async getGameState(gameId) {
        const result = await gameEngine.loadGameState(gameId);
        return result.success ? result.gameState : null;
    }

    async checkAndStartTurn(gameId) {
        try {
            const game = await db.query('SELECT current_turn_player_id FROM games WHERE id = ?', [gameId]);
            if (game.length > 0) {
                const currentPlayerId = game[0].current_turn_player_id;
                if (currentPlayerId) {
                    const player = await db.query('SELECT player_name FROM game_players WHERE id = ?', [currentPlayerId]);
                    if (player.length > 0) {
                        await this.notifyPlayerTurn(gameId, currentPlayerId, player[0].player_name);
                    }
                }
            }
        } catch (error) {
            console.error('Error checking and starting turn:', error);
        }
    }

    // Spiel-Statistiken
    async handleGetGameStats(socket, data) {
        try {
            const { gameId } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            // Sammle Statistiken
            const stats = await db.query(`
                SELECT 
                    gp.player_name,
                    gp.gold,
                    gp.player_level,
                    COUNT(DISTINCT gu.id) as unit_count,
                    COUNT(DISTINCT CASE WHEN gm.building_name = 'Stadt' THEN gm.id END) as cities,
                    COUNT(DISTINCT CASE WHEN gm.building_name = 'Burg' THEN gm.id END) as castles,
                    r.name as race_name,
                    r.color_hex as race_color
                FROM game_players gp
                LEFT JOIN game_units gu ON gp.id = gu.player_id
                LEFT JOIN game_maps gm ON gp.id = gm.owner_player_id AND gm.building_type_id IS NOT NULL
                LEFT JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.is_active = 1
                GROUP BY gp.id, gp.player_name, gp.gold, gp.player_level, r.name, r.color_hex
                ORDER BY gp.turn_order
            `, [gameId]);

            socket.emit('game_stats', { stats: stats });

        } catch (error) {
            console.error('Error getting game stats:', error);
            socket.emit('error', { message: 'Fehler beim Laden der Spielstatistiken' });
        }
    }

    // Chat-Nachrichten im Spiel
    async handleGameChatMessage(socket, data) {
        try {
            const { gameId, message } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            if (!message || message.trim().length === 0) {
                return;
            }

            console.log(`💬 Game chat from ${playerInfo.playerName}: ${message}`);

            // Chat-Nachricht an alle Spieler im Spiel
            this.io.to(`game_${gameId}`).emit('game_chat_message', {
                playerName: playerInfo.playerName,
                message: message.trim(),
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error handling game chat message:', error);
        }
    }

    // Spiel verlassen
    async handleLeaveGame(socket, data) {
        try {
            const { gameId } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Du bist nicht in diesem Spiel' });
                return;
            }

            console.log(`🚪 Player ${playerInfo.playerName} leaving game ${gameId}`);

            // Spieler als inaktiv markieren
            await db.query(`
                UPDATE game_players 
                SET is_active = 0 
                WHERE game_id = ? AND id = ?
            `, [gameId, playerInfo.playerId]);

            // Socket aus Room entfernen
            socket.leave(`game_${gameId}`);
            this.handleDisconnect(socket);

            // Andere Spieler benachrichtigen
            this.io.to(`game_${gameId}`).emit('player_left_game', {
                playerName: playerInfo.playerName,
                message: `${playerInfo.playerName} hat das Spiel verlassen`
            });

            // Spiel-Ende prüfen
            const gameEndResult = await turnManager.checkGameEnd(gameId);
            if (gameEndResult.gameEnded) {
                this.io.to(`game_${gameId}`).emit('game_ended', {
                    winner: gameEndResult.winner,
                    message: gameEndResult.winner 
                        ? `${gameEndResult.winner.player_name} hat gewonnen!` 
                        : 'Spiel beendet - Alle Spieler haben verlassen'
                });
            }

            // Bestätigung an Spieler
            socket.emit('left_game_success', {
                message: 'Du hast das Spiel erfolgreich verlassen'
            });

        } catch (error) {
            console.error('Error handling leave game:', error);
            socket.emit('error', { message: 'Fehler beim Verlassen des Spiels' });
        }
    }
}

module.exports = GameHandlers;.log(`🎮 Player ${playerName} joining game room ${gameId}`);

            // Validierung
            if (!gameId || !playerName) {
                socket.emit('error', { message: 'Ungültige Daten für Spiel-Beitritt' });
                return;
            }

            // Prüfe ob Spiel existiert und Spieler teilnimmt
            const player = await db.query(`
                SELECT gp.id, gp.player_name, gp.gold, gp.race_id, g.status
                FROM game_players gp
                JOIN games g ON gp.game_id = g.id
                WHERE gp.game_id = ? AND gp.player_name = ? AND gp.is_active = 1
            `, [gameId, playerName]);

            if (player.length === 0) {
                socket.emit('error', { message: 'Du bist nicht Teil dieses Spiels' });
                return;
            }

            const playerData = player[0];

            // Socket dem Spiel-Room hinzufügen
            socket.join(`game_${gameId}`);
            
            // Room-Verwaltung
            if (!this.gameRooms.has(gameId)) {
                this.gameRooms.set(gameId, new Set());
            }
            this.gameRooms.get(gameId).add(socket.id);
            
            // Socket-zu-Spieler Mapping
            this.playerSockets.set(socket.id, {
                gameId: gameId,
                playerId: playerData.id,
                playerName: playerName
            });

            console.log(`✅ Player ${playerName} joined game ${gameId} room`);

            // Aktuellen Spielzustand senden
            await this.sendGameStateToPlayer(socket, gameId, playerData.id);

            // Anderen Spielern mitteilen
            socket.to(`game_${gameId}`).emit('player_joined_game', {
                playerName: playerName,
                playerId: playerData.id
            });

            // Wenn Spiel läuft, Zug prüfen
            if (playerData.status === 'playing') {
                await this.checkAndStartTurn(gameId);
            }

        } catch (error) {
            console.error('Error handling join game room:', error);
            socket.emit('error', { message: 'Fehler beim Beitreten des Spiels' });
        }
    }

    // Spielzustand an Spieler senden
    async sendGameStateToPlayer(socket, gameId, playerId) {
        try {
            const gameStateResult = await gameEngine.loadGameState(gameId);
            
            if (!gameStateResult.success) {
                socket.emit('error', { message: gameStateResult.message });
                return;
            }

            // Prüfe ob Spieler am Zug ist
            const currentPlayerId = gameStateResult.gameState.game.current_turn_player_id;
            const isMyTurn = currentPlayerId === playerId;

            socket.emit('game_state_updated', {
                gameState: gameStateResult.gameState,
                isMyTurn: isMyTurn,
                playerId: playerId
            });

            // Falls Spieler am Zug ist, Zug starten
            if (isMyTurn) {
                const turnResult = await turnManager.startTurn(gameId, playerId);
                if (turnResult.success) {
                    socket.emit('turn_started', {
                        isMyTurn: true,
                        goldIncome: turnResult.goldIncome,
                        message: turnResult.message
                    });
                }
            }

        } catch (error) {
            console.error('Error sending game state:', error);
            socket.emit('error', { message: 'Fehler beim Laden des Spielzustands' });
        }
    }

    // Einheit bewegen
    async handleMoveUnit(socket, data) {
        try {
            const { gameId, unitId, targetX, targetY } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            console.log(`🚶 Player ${playerInfo.playerName} moving unit ${unitId} to (${targetX}, ${targetY})`);

            const result = await turnManager.moveUnit(gameId, playerInfo.playerId, unitId, targetX, targetY);

            // Ergebnis an Spieler senden
            socket.emit('unit_moved', result);

            // Bei Erfolg alle Spieler informieren
            if (result.success) {
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: await this.getGameState(gameId)
                });

                socket.to(`game_${gameId}`).emit('unit_moved', {
                    success: true,
                    playerName: playerInfo.playerName,
                    fromX: result.fromX,
                    fromY: result.fromY,
                    toX: result.toX,
                    toY: result.toY,
                    unitId: unitId
                });
            }

        } catch (error) {
            console.error('Error handling move unit:', error);
            socket.emit('unit_moved', { success: false, message: 'Fehler bei der Bewegung' });
        }
    }

    // Einheit angreifen
    async handleAttackUnit(socket, data) {
        try {
            const { gameId, attackerUnitId, targetX, targetY } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            console