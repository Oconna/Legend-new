// server/socketHandlers/gameHandlers.js
// Vollständige Socket-Handler für Spielfunktionen

const gameEngine = require('../controllers/gameEngine');
const turnManager = require('../controllers/turnManager');
const db = require('../config/database');

class GameHandlers {
    constructor(io) {
        this.io = io;
        this.gameRooms = new Map(); // gameId -> Set of socketIds
        this.playerSockets = new Map(); // socketId -> {gameId, playerId, playerName}
        this.gameTurnTimers = new Map(); // gameId -> timer for turn limits
    }

    // ===== ROOM MANAGEMENT =====

    // Spieler tritt Spiel-Room bei
    async handleJoinGameRoom(socket, data) {
        try {
            const { gameId, playerName } = data;
            
            console.log(`🎮 Player ${playerName} joining game room ${gameId}`);

            // Validierung
            if (!gameId || !playerName) {
                socket.emit('error', { message: 'Ungültige Daten für Spiel-Beitritt' });
                return;
            }

            // Prüfe ob Spiel existiert und Spieler teilnimmt
            const player = await db.query(`
                SELECT gp.id, gp.player_name, gp.gold, gp.race_id, gp.player_level, 
                       g.status, g.current_turn_player_id, g.turn_number,
                       r.name as race_name, r.color_hex as race_color
                FROM game_players gp
                JOIN games g ON gp.game_id = g.id
                LEFT JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.player_name = ? AND gp.is_active = 1
            `, [gameId, playerName]);

            if (player.length === 0) {
                socket.emit('error', { message: 'Du bist nicht Teil dieses Spiels oder das Spiel existiert nicht' });
                return;
            }

            const playerData = player[0];

            // Prüfe Spielstatus
            if (playerData.status !== 'playing') {
                socket.emit('error', { message: 'Spiel ist noch nicht gestartet oder bereits beendet' });
                return;
            }

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
                playerId: playerData.id,
                message: `${playerName} ist dem Spiel beigetreten`
            });

            // Wenn Spieler am Zug ist, Zug-Informationen senden
            if (playerData.current_turn_player_id === playerData.id) {
                await this.notifyPlayerTurn(gameId, playerData.id, playerName);
            }

        } catch (error) {
            console.error('Error handling join game room:', error);
            socket.emit('error', { message: 'Fehler beim Beitreten des Spiels: ' + error.message });
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

            // Vollständigen Spielzustand senden
            socket.emit('game_state_updated', {
                gameState: gameStateResult.gameState,
                isMyTurn: isMyTurn,
                playerId: playerId,
                timestamp: new Date().toISOString()
            });

            // Falls Spieler am Zug ist, zusätzliche Zug-Informationen
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

            console.log(`📊 Game state sent to player ${playerId} in game ${gameId}`);

        } catch (error) {
            console.error('Error sending game state:', error);
            socket.emit('error', { message: 'Fehler beim Laden des Spielzustands: ' + error.message });
        }
    }

    // ===== UNIT ACTIONS =====

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

            // Bei Erfolg alle Spieler informieren und Spielzustand aktualisieren
            if (result.success) {
                const gameState = await this.getGameState(gameId);
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: gameState
                });

                // Bewegungs-Event an andere Spieler
                socket.to(`game_${gameId}`).emit('unit_moved_by_player', {
                    success: true,
                    playerName: playerInfo.playerName,
                    fromX: result.fromX,
                    fromY: result.fromY,
                    toX: result.toX,
                    toY: result.toY,
                    unitId: unitId,
                    movementCost: result.movementCost
                });

                // Event loggen
                await this.logGameEvent(gameId, playerInfo.playerId, 'unit_move', {
                    unitId: unitId,
                    fromX: result.fromX,
                    fromY: result.fromY,
                    toX: result.toX,
                    toY: result.toY,
                    movementCost: result.movementCost
                });
            }

        } catch (error) {
            console.error('Error handling move unit:', error);
            socket.emit('unit_moved', { success: false, message: 'Fehler bei der Bewegung: ' + error.message });
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

            console.log(`⚔️ Player ${playerInfo.playerName} attacking with unit ${attackerUnitId} at (${targetX}, ${targetY})`);

            const result = await turnManager.attackUnit(gameId, playerInfo.playerId, attackerUnitId, targetX, targetY);

            // Ergebnis an Spieler senden
            socket.emit('unit_attacked', result);

            // Bei Erfolg alle Spieler informieren
            if (result.success) {
                const gameState = await this.getGameState(gameId);
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: gameState
                });

                // Battle-Nachricht an alle Spieler
                this.io.to(`game_${gameId}`).emit('battle_result', {
                    attackerName: result.attackerName,
                    targetName: result.targetName,
                    targetPlayer: result.targetPlayer,
                    damage: result.damage,
                    targetDestroyed: result.targetDestroyed,
                    attackerPlayer: playerInfo.playerName,
                    targetX: targetX,
                    targetY: targetY
                });

                // Event loggen
                await this.logGameEvent(gameId, playerInfo.playerId, 'unit_attack', {
                    attackerUnitId: attackerUnitId,
                    targetX: targetX,
                    targetY: targetY,
                    damage: result.damage,
                    targetDestroyed: result.targetDestroyed
                });

                // Prüfe Spielende
                const gameEndResult = await turnManager.checkGameEnd(gameId);
                if (gameEndResult.gameEnded) {
                    await this.handleGameEnd(gameId, gameEndResult.winner);
                }
            }

        } catch (error) {
            console.error('Error handling attack unit:', error);
            socket.emit('unit_attacked', { success: false, message: 'Fehler beim Angriff: ' + error.message });
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
                const gameState = await this.getGameState(gameId);
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: gameState
                });

                // Kauf-Event an andere Spieler
                socket.to(`game_${gameId}`).emit('unit_purchased_by_player', {
                    success: true,
                    playerName: playerInfo.playerName,
                    unitName: result.unitName,
                    buildingX: buildingX,
                    buildingY: buildingY,
                    cost: result.cost
                });

                // Event loggen
                await this.logGameEvent(gameId, playerInfo.playerId, 'unit_purchase', {
                    unitId: unitId,
                    unitName: result.unitName,
                    buildingX: buildingX,
                    buildingY: buildingY,
                    cost: result.cost
                });
            }

        } catch (error) {
            console.error('Error handling buy unit:', error);
            socket.emit('unit_purchased', { success: false, message: 'Fehler beim Einheitenkauf: ' + error.message });
        }
    }

    // ===== PLAYER ACTIONS =====

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
                const gameState = await this.getGameState(gameId);
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: gameState
                });

                // Level-Up Event an andere Spieler
                socket.to(`game_${gameId}`).emit('player_leveled_up', {
                    playerName: playerInfo.playerName,
                    newLevel: result.newLevel,
                    cost: result.cost
                });

                // Event loggen
                await this.logGameEvent(gameId, playerInfo.playerId, 'player_level_up', {
                    newLevel: result.newLevel,
                    cost: result.cost
                });
            }

        } catch (error) {
            console.error('Error handling upgrade level:', error);
            socket.emit('action_result', { success: false, message: 'Fehler beim Stufenaufstieg: ' + error.message });
        }
    }

    // ===== TURN MANAGEMENT =====

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
                // Event loggen
                await this.logGameEvent(gameId, playerInfo.playerId, 'turn_end', {
                    turnNumber: result.turnNumber,
                    nextPlayer: result.nextPlayerName
                });

                // Aktueller Spieler - Zug beendet
                socket.emit('turn_ended', {
                    success: true,
                    nextPlayerName: result.nextPlayerName,
                    turnNumber: result.turnNumber,
                    message: `Zug beendet. ${result.nextPlayerName} ist jetzt an der Reihe.`
                });

                // Alle anderen Spieler - neuer Zug
                socket.to(`game_${gameId}`).emit('turn_ended', {
                    success: true,
                    nextPlayerName: result.nextPlayerName,
                    turnNumber: result.turnNumber,
                    previousPlayer: playerInfo.playerName
                });

                // Neuer Spielzustand für alle
                const gameState = await this.getGameState(gameId);
                this.io.to(`game_${gameId}`).emit('game_state_updated', {
                    gameState: gameState
                });

                // Nächsten Spieler über seinen Zug informieren
                setTimeout(() => {
                    this.notifyPlayerTurn(gameId, result.nextPlayerId, result.nextPlayerName);
                }, 1000); // Kurze Verzögerung für bessere UX

            } else {
                socket.emit('turn_ended', result);
            }

        } catch (error) {
            console.error('Error handling end turn:', error);
            socket.emit('turn_ended', { success: false, message: 'Fehler beim Zugwechsel: ' + error.message });
        }
    }

    // Spieler über seinen Zug benachrichtigen
    async notifyPlayerTurn(gameId, playerId, playerName) {
        try {
            // Gold-Einkommen starten und Bewegungspunkte zurücksetzen
            const turnResult = await turnManager.startTurn(gameId, playerId);

            if (turnResult.success) {
                // Event loggen
                await this.logGameEvent(gameId, playerId, 'turn_start', {
                    goldIncome: turnResult.goldIncome
                });

                // Allen Spielern mitteilen wer am Zug ist
                this.io.to(`game_${gameId}`).emit('turn_started', {
                    currentPlayerId: playerId,
                    currentPlayerName: playerName,
                    goldIncome: turnResult.goldIncome || 0,
                    message: `${playerName} ist am Zug`
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
                            message: `Dein Zug! Du erhältst ${turnResult.goldIncome} Gold.`
                        });
                    }
                });
            }

        } catch (error) {
            console.error('Error notifying player turn:', error);
        }
    }

    // ===== DATA QUERIES =====

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
                SELECT u.*, gp.gold as player_gold, gp.player_level,
                       r.name as race_name, r.color_hex as race_color
                FROM units u
                JOIN game_players gp ON u.race_id = gp.race_id
                JOIN races r ON u.race_id = r.id
                WHERE gp.game_id = ? AND gp.id = ?
                ORDER BY u.cost, u.name
            `, [gameId, playerInfo.playerId]);

            socket.emit('available_units', {
                units: units,
                playerId: playerInfo.playerId,
                playerGold: units[0]?.player_gold || 0,
                playerLevel: units[0]?.player_level || 1
            });

        } catch (error) {
            console.error('Error getting available units:', error);
            socket.emit('error', { message: 'Fehler beim Laden der verfügbaren Einheiten: ' + error.message });
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
                    gp.id,
                    gp.player_name,
                    gp.gold,
                    gp.player_level,
                    gp.turn_order,
                    COUNT(DISTINCT gu.id) as unit_count,
                    COUNT(DISTINCT CASE WHEN gm.building_type_id = 1 THEN gm.id END) as cities,
                    COUNT(DISTINCT CASE WHEN gm.building_type_id = 2 THEN gm.id END) as castles,
                    r.name as race_name,
                    r.color_hex as race_color,
                    SUM(CASE WHEN gm.building_type_id IS NOT NULL THEN bt.gold_income ELSE 0 END) as income_per_turn
                FROM game_players gp
                LEFT JOIN game_units gu ON gp.id = gu.player_id
                LEFT JOIN game_maps gm ON gp.id = gm.owner_player_id
                LEFT JOIN building_types bt ON gm.building_type_id = bt.id
                LEFT JOIN races r ON gp.race_id = r.id
                WHERE gp.game_id = ? AND gp.is_active = 1
                GROUP BY gp.id, gp.player_name, gp.gold, gp.player_level, gp.turn_order, r.name, r.color_hex
                ORDER BY gp.turn_order
            `, [gameId]);

            socket.emit('game_stats', { stats: stats });

        } catch (error) {
            console.error('Error getting game stats:', error);
            socket.emit('error', { message: 'Fehler beim Laden der Spielstatistiken: ' + error.message });
        }
    }

    // ===== CHAT SYSTEM =====

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

            const cleanMessage = message.trim().substring(0, 200); // Max 200 Zeichen

            console.log(`💬 Game chat from ${playerInfo.playerName}: ${cleanMessage}`);

            // Chat-Nachricht in Datenbank speichern
            await db.query(`
                INSERT INTO game_chat (game_id, player_id, message, message_type)
                VALUES (?, ?, ?, 'chat')
            `, [gameId, playerInfo.playerId, cleanMessage]);

            // Chat-Nachricht an alle Spieler im Spiel
            this.io.to(`game_${gameId}`).emit('game_chat_message', {
                playerName: playerInfo.playerName,
                playerId: playerInfo.playerId,
                message: cleanMessage,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error handling game chat message:', error);
            socket.emit('error', { message: 'Fehler beim Senden der Chat-Nachricht: ' + error.message });
        }
    }

    // ===== GAME MANAGEMENT =====

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

            // Event loggen
            await this.logGameEvent(gameId, playerInfo.playerId, 'player_leave', {
                playerName: playerInfo.playerName
            });

            // Socket aus Room entfernen
            socket.leave(`game_${gameId}`);
            this.handleDisconnect(socket);

            // Andere Spieler benachrichtigen
            this.io.to(`game_${gameId}`).emit('player_left_game', {
                playerName: playerInfo.playerName,
                message: `${playerInfo.playerName} hat das Spiel verlassen`
            });

            // System-Chat-Nachricht
            await db.query(`
                INSERT INTO game_chat (game_id, player_id, message, message_type)
                VALUES (?, ?, ?, 'system')
            `, [gameId, playerInfo.playerId, `${playerInfo.playerName} hat das Spiel verlassen`]);

            // Spiel-Ende prüfen
            const gameEndResult = await turnManager.checkGameEnd(gameId);
            if (gameEndResult.gameEnded) {
                await this.handleGameEnd(gameId, gameEndResult.winner);
            }

            // Bestätigung an Spieler
            socket.emit('left_game_success', {
                message: 'Du hast das Spiel erfolgreich verlassen'
            });

        } catch (error) {
            console.error('Error handling leave game:', error);
            socket.emit('error', { message: 'Fehler beim Verlassen des Spiels: ' + error.message });
        }
    }

    // Spiel-Ende behandeln
    async handleGameEnd(gameId, winner) {
        try {
            console.log(`🏆 Game ${gameId} ended. Winner: ${winner ? winner.player_name : 'None'}`);

            // Event loggen
            await this.logGameEvent(gameId, winner ? winner.id : null, 'game_end', {
                winner: winner ? winner.player_name : null
            });

            // Alle Spieler benachrichtigen
            this.io.to(`game_${gameId}`).emit('game_ended', {
                winner: winner,
                message: winner 
                    ? `🏆 ${winner.player_name} hat gewonnen!` 
                    : 'Spiel beendet - Unentschieden',
                timestamp: new Date().toISOString()
            });

            // System-Chat-Nachricht
            const endMessage = winner 
                ? `🏆 ${winner.player_name} hat das Spiel gewonnen!` 
                : 'Spiel beendet - Alle Spieler haben aufgegeben';

            await db.query(`
                INSERT INTO game_chat (game_id, player_id, message, message_type)
                VALUES (?, NULL, ?, 'system')
            `, [gameId, endMessage]);

            // Cleanup nach 30 Sekunden
            setTimeout(() => {
                this.cleanupGame(gameId);
            }, 30000);

        } catch (error) {
            console.error('Error handling game end:', error);
        }
    }

    // ===== DISCONNECT HANDLING =====

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

    // ===== UTILITY METHODS =====

    // Spielzustand abrufen
    async getGameState(gameId) {
        const result = await gameEngine.loadGameState(gameId);
        return result.success ? result.gameState : null;
    }

    // Zug prüfen und starten
    async checkAndStartTurn(gameId) {
        try {
            const game = await db.query('SELECT current_turn_player_id, turn_number FROM games WHERE id = ?', [gameId]);
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

    // Game Event loggen
    async logGameEvent(gameId, playerId, eventType, eventData) {
        try {
            const turnNumber = await db.query('SELECT turn_number FROM games WHERE id = ?', [gameId]);
            const currentTurn = turnNumber.length > 0 ? turnNumber[0].turn_number : 1;

            await db.query(`
                INSERT INTO game_events (game_id, player_id, event_type, event_data, turn_number)
                VALUES (?, ?, ?, ?, ?)
            `, [gameId, playerId, eventType, JSON.stringify(eventData), currentTurn]);

        } catch (error) {
            console.error('Error logging game event:', error);
        }
    }

    // Game Cleanup
    cleanupGame(gameId) {
        try {
            console.log(`🧹 Cleaning up game ${gameId}`);

            // Room cleanup
            if (this.gameRooms.has(gameId)) {
                this.gameRooms.delete(gameId);
            }

            // Turn timer cleanup
            if (this.gameTurnTimers.has(gameId)) {
                clearTimeout(this.gameTurnTimers.get(gameId));
                this.gameTurnTimers.delete(gameId);
            }

            // Player socket cleanup
            for (const [socketId, playerInfo] of this.playerSockets.entries()) {
                if (playerInfo.gameId === gameId) {
                    this.playerSockets.delete(socketId);
                }
            }

            console.log(`✅ Game ${gameId} cleanup completed`);

        } catch (error) {
            console.error('Error cleaning up game:', error);
        }
    }

    // ===== ADDITIONAL GAME FEATURES =====

    // Reconnect Handler - Spieler kehrt zum Spiel zurück
    async handleReconnectToGame(socket, data) {
        try {
            const { gameId, playerName } = data;
            
            console.log(`🔄 Player ${playerName} reconnecting to game ${gameId}`);

            // Prüfe ob Spieler Teil des Spiels ist
            const player = await db.query(`
                SELECT gp.id, gp.player_name, g.status
                FROM game_players gp
                JOIN games g ON gp.game_id = g.id
                WHERE gp.game_id = ? AND gp.player_name = ? AND gp.is_active = 1
            `, [gameId, playerName]);

            if (player.length === 0) {
                socket.emit('error', { message: 'Du bist nicht Teil dieses Spiels' });
                return;
            }

            // Normaler Join-Prozess
            await this.handleJoinGameRoom(socket, { gameId, playerName });

            socket.emit('reconnect_success', {
                message: 'Erfolgreich zum Spiel zurückgekehrt',
                gameId: gameId
            });

        } catch (error) {
            console.error('Error handling reconnect:', error);
            socket.emit('error', { message: 'Fehler beim Wiederverbinden: ' + error.message });
        }
    }

    // Chat-History laden
    async handleLoadChatHistory(socket, data) {
        try {
            const { gameId, limit = 50 } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            const chatHistory = await db.query(`
                SELECT 
                    gc.*,
                    gp.player_name
                FROM game_chat gc
                LEFT JOIN game_players gp ON gc.player_id = gp.id
                WHERE gc.game_id = ?
                ORDER BY gc.created_at DESC
                LIMIT ?
            `, [gameId, limit]);

            socket.emit('chat_history', {
                messages: chatHistory.reverse(), // Neueste zuletzt
                gameId: gameId
            });

        } catch (error) {
            console.error('Error loading chat history:', error);
            socket.emit('error', { message: 'Fehler beim Laden des Chat-Verlaufs: ' + error.message });
        }
    }

    // Game Events laden (für Replay/History)
    async handleGetGameEvents(socket, data) {
        try {
            const { gameId, limit = 100, offset = 0 } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            const events = await db.query(`
                SELECT 
                    ge.*,
                    gp.player_name
                FROM game_events ge
                LEFT JOIN game_players gp ON ge.player_id = gp.id
                WHERE ge.game_id = ?
                ORDER BY ge.created_at DESC
                LIMIT ? OFFSET ?
            `, [gameId, limit, offset]);

            socket.emit('game_events', {
                events: events,
                gameId: gameId,
                limit: limit,
                offset: offset
            });

        } catch (error) {
            console.error('Error getting game events:', error);
            socket.emit('error', { message: 'Fehler beim Laden der Spiel-Events: ' + error.message });
        }
    }

    // Spieler-Details abrufen
    async handleGetPlayerDetails(socket, data) {
        try {
            const { gameId, playerId } = data;
            const playerInfo = this.playerSockets.get(socket.id);

            if (!playerInfo || playerInfo.gameId !== gameId) {
                socket.emit('error', { message: 'Ungültige Spieler-Session' });
                return;
            }

            const playerDetails = await db.query(`
                SELECT 
                    gp.*,
                    r.name as race_name,
                    r.description as race_description,
                    r.color_hex as race_color,
                    COUNT(DISTINCT gu.id) as total_units,
                    COUNT(DISTINCT gm.id) as total_buildings,
                    SUM(CASE WHEN bt.name = 'Stadt' THEN bt.gold_income ELSE 0 END) as city_income,
                    SUM(CASE WHEN bt.name = 'Burg' THEN bt.gold_income ELSE 0 END) as castle_income
                FROM game_players gp
                LEFT JOIN races r ON gp.race_id = r.id
                LEFT JOIN game_units gu ON gp.id = gu.player_id
                LEFT JOIN game_maps gm ON gp.id = gm.owner_player_id AND gm.building_type_id IS NOT NULL
                LEFT JOIN building_types bt ON gm.building_type_id = bt.id
                WHERE gp.game_id = ? AND gp.id = ? AND gp.is_active = 1
                GROUP BY gp.id
            `, [gameId, playerId]);

            if (playerDetails.length === 0) {
                socket.emit('error', { message: 'Spieler nicht gefunden' });
                return;
            }

            socket.emit('player_details', {
                player: playerDetails[0],
                gameId: gameId
            });

        } catch (error) {
            console.error('Error getting player details:', error);
            socket.emit('error', { message: 'Fehler beim Laden der Spieler-Details: ' + error.message });
        }
    }

    // Turn Timer (optional - für zeitbegrenzte Züge)
    startTurnTimer(gameId, playerId, timeLimit = 300000) { // 5 Minuten default
        if (this.gameTurnTimers.has(gameId)) {
            clearTimeout(this.gameTurnTimers.get(gameId));
        }

        const timer = setTimeout(async () => {
            console.log(`⏰ Turn timer expired for player ${playerId} in game ${gameId}`);
            
            // Automatisch Zug beenden
            try {
                const result = await turnManager.endTurn(gameId, playerId);
                if (result.success) {
                    this.io.to(`game_${gameId}`).emit('turn_ended_by_timeout', {
                        playerId: playerId,
                        nextPlayerName: result.nextPlayerName,
                        message: 'Zug durch Zeitüberschreitung beendet'
                    });

                    // Nächsten Spieler benachrichtigen
                    setTimeout(() => {
                        this.notifyPlayerTurn(gameId, result.nextPlayerId, result.nextPlayerName);
                    }, 1000);
                }
            } catch (error) {
                console.error('Error ending turn by timeout:', error);
            }

            this.gameTurnTimers.delete(gameId);
        }, timeLimit);

        this.gameTurnTimers.set(gameId, timer);
    }

    // ===== STATUS AND MONITORING =====

    // Server Status für Admin
    getServerStatus() {
        return {
            activeGames: this.gameRooms.size,
            totalPlayers: this.playerSockets.size,
            runningTimers: this.gameTurnTimers.size,
            gameRooms: Array.from(this.gameRooms.keys()),
            memory: {
                gameRooms: this.gameRooms.size,
                playerSockets: this.playerSockets.size,
                turnTimers: this.gameTurnTimers.size
            },
            timestamp: new Date().toISOString()
        };
    }

    // Health Check
    async healthCheck() {
        try {
            // Test database connection
            await db.query('SELECT 1');
            
            return {
                status: 'healthy',
                activeGames: this.gameRooms.size,
                totalPlayers: this.playerSockets.size,
                database: 'connected',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // ===== ADMIN FUNCTIONS =====

    // Force end game (Admin)
    async forceEndGame(gameId, reason = 'Admin beendet') {
        try {
            console.log(`⚠️ Force ending game ${gameId}: ${reason}`);

            await db.query(`
                UPDATE games 
                SET status = 'finished', finished_at = NOW()
                WHERE id = ?
            `, [gameId]);

            this.io.to(`game_${gameId}`).emit('game_force_ended', {
                reason: reason,
                message: `Spiel wurde beendet: ${reason}`
            });

            await this.logGameEvent(gameId, null, 'game_force_end', { reason });
            
            this.cleanupGame(gameId);

            return { success: true, message: 'Spiel erfolgreich beendet' };

        } catch (error) {
            console.error('Error force ending game:', error);
            return { success: false, error: error.message };
        }
    }

    // Kick player (Admin)
    async kickPlayer(gameId, playerId, reason = 'Vom Admin entfernt') {
        try {
            console.log(`⚠️ Kicking player ${playerId} from game ${gameId}: ${reason}`);

            await db.query(`
                UPDATE game_players 
                SET is_active = 0 
                WHERE game_id = ? AND id = ?
            `, [gameId, playerId]);

            // Find and disconnect player socket
            for (const [socketId, playerInfo] of this.playerSockets.entries()) {
                if (playerInfo.gameId === gameId && playerInfo.playerId === playerId) {
                    const socket = this.io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.emit('kicked_from_game', {
                            reason: reason,
                            message: `Du wurdest aus dem Spiel entfernt: ${reason}`
                        });
                        socket.disconnect();
                    }
                    break;
                }
            }

            this.io.to(`game_${gameId}`).emit('player_kicked', {
                playerId: playerId,
                reason: reason
            });

            await this.logGameEvent(gameId, playerId, 'player_kicked', { reason });

            return { success: true, message: 'Spieler erfolgreich entfernt' };

        } catch (error) {
            console.error('Error kicking player:', error);
            return { success: false, error: error.message };
        }
    }

    // ===== PERFORMANCE MONITORING =====

    // Memory cleanup (periodisch aufrufen)
    performMemoryCleanup() {
        const now = Date.now();
        let cleaned = 0;

        // Cleanup inactive game rooms
        for (const [gameId, sockets] of this.gameRooms.entries()) {
            if (sockets.size === 0) {
                this.gameRooms.delete(gameId);
                cleaned++;
            }
        }

        // Cleanup orphaned player sockets
        for (const [socketId, playerInfo] of this.playerSockets.entries()) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (!socket || !socket.connected) {
                this.playerSockets.delete(socketId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} inactive entries`);
        }

        return cleaned;
    }
}

module.exports = GameHandlers;