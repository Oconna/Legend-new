const db = require('../config/database');

// Export functions directly instead of a class instance
async function createGame(gameName, maxPlayers, mapSize, playerName, socketId) {
    try {
        console.log('Creating game with params:', { gameName, maxPlayers, mapSize, playerName, socketId });

        // Validierung
        if (!gameName || gameName.trim().length === 0) {
            return { success: false, message: 'Spielname erforderlich' };
        }
        
        if (!playerName || playerName.trim().length === 0) {
            return { success: false, message: 'Spielername erforderlich' };
        }
        
        if (maxPlayers < 2 || maxPlayers > 8) {
            return { success: false, message: 'Spieleranzahl muss zwischen 2 und 8 liegen' };
        }

        if (![20, 30, 50, 100].includes(mapSize)) {
            return { success: false, message: 'Ungültige Kartengröße' };
        }

        // Prüfe ob Spielname bereits existiert (für aktive Spiele)
        const existingGame = await db.query(
            'SELECT id FROM games WHERE name = ? AND status != "finished"', 
            [gameName.trim()]
        );

        if (existingGame.length > 0) {
            return { success: false, message: 'Spielname bereits vergeben' };
        }

        // Erstelle neues Spiel
        const result = await db.query(
            'INSERT INTO games (name, max_players, map_size, status, current_players) VALUES (?, ?, ?, ?, ?)',
            [gameName.trim(), maxPlayers, mapSize, 'waiting', 1]
        );

        const gameId = result.insertId;
        console.log('Game created with ID:', gameId);

        // Füge ersten Spieler hinzu (Host)
        await db.query(
            'INSERT INTO game_players (game_id, player_name, socket_id, is_host, is_ready) VALUES (?, ?, ?, ?, ?)',
            [gameId, playerName.trim(), socketId, true, false]
        );

        console.log('Host player added to game');

        return {
            success: true,
            gameId: gameId,
            gameName: gameName.trim(),
            message: 'Spiel erfolgreich erstellt',
            currentPlayers: 1,
            maxPlayers: maxPlayers,
            mapSize: mapSize,
            isHost: true
        };

    } catch (error) {
        console.error('Error creating game:', error);
        return { success: false, message: 'Fehler beim Erstellen des Spiels: ' + error.message };
    }
}

async function joinGame(gameId, playerName, socketId) {
    try {
        console.log('Joining game with params:', { gameId, playerName, socketId });

        // Validierung
        if (!playerName || playerName.trim().length === 0) {
            return { success: false, message: 'Spielername erforderlich' };
        }

        if (!gameId || isNaN(gameId)) {
            return { success: false, message: 'Ungültige Spiel-ID' };
        }

        // Prüfe ob Spiel existiert und noch Platz hat
        const game = await db.query(
            'SELECT * FROM games WHERE id = ? AND status = "waiting"',
            [gameId]
        );

        if (game.length === 0) {
            return { success: false, message: 'Spiel nicht gefunden oder bereits gestartet' };
        }

        const gameData = game[0];
        console.log('Found game:', gameData);

        // Prüfe ob Spielername bereits in diesem Spiel existiert (aktive Spieler)
        const existingPlayer = await db.query(
            'SELECT id, is_active FROM game_players WHERE game_id = ? AND player_name = ?',
            [gameId, playerName.trim()]
        );

        if (existingPlayer.length > 0) {
            // Wenn Spieler existiert aber inaktiv ist, reaktiviere ihn
            if (!existingPlayer[0].is_active) {
                await db.query(
                    'UPDATE game_players SET is_active = true, socket_id = ? WHERE id = ?',
                    [socketId, existingPlayer[0].id]
                );
                
                console.log('Reactivated existing player');
                
                return {
                    success: true,
                    gameId: gameId,
                    gameName: gameData.name,
                    message: 'Erfolgreich wieder dem Spiel beigetreten',
                    currentPlayers: gameData.current_players,
                    maxPlayers: gameData.max_players,
                    mapSize: gameData.map_size,
                    isHost: false
                };
            } else {
                return { success: false, message: 'Spielername bereits in diesem Spiel vergeben' };
            }
        }

        // Prüfe ob noch Platz ist
        if (gameData.current_players >= gameData.max_players) {
            return { success: false, message: 'Spiel ist bereits voll' };
        }

        // Füge neuen Spieler hinzu
        await db.query(
            'INSERT INTO game_players (game_id, player_name, socket_id, is_host, is_ready) VALUES (?, ?, ?, ?, ?)',
            [gameId, playerName.trim(), socketId, false, false]
        );

        // Update current_players count
        const newPlayerCount = gameData.current_players + 1;
        await db.query(
            'UPDATE games SET current_players = ? WHERE id = ?',
            [newPlayerCount, gameId]
        );

        console.log('Player added to game, new count:', newPlayerCount);

        return {
            success: true,
            gameId: gameId,
            gameName: gameData.name,
            message: 'Spiel erfolgreich beigetreten',
            currentPlayers: newPlayerCount,
            maxPlayers: gameData.max_players,
            mapSize: gameData.map_size,
            isHost: false
        };

    } catch (error) {
        console.error('Error joining game:', error);
        return { success: false, message: 'Fehler beim Beitreten des Spiels: ' + error.message };
    }
}

async function getGamePlayers(gameId) {
    try {
        const players = await db.query(`
            SELECT 
                gp.*,
                r.name as race_name,
                r.color_hex as race_color
            FROM game_players gp
            LEFT JOIN races r ON gp.race_id = r.id
            WHERE gp.game_id = ? AND gp.is_active = true
            ORDER BY gp.joined_at
        `, [gameId]);

        return players;
    } catch (error) {
        console.error('Error getting game players:', error);
        return [];
    }
}

async function getAvailableGames() {
    try {
        const games = await db.query(`
            SELECT 
                g.id,
                g.name,
                g.max_players,
                g.current_players,
                g.map_size,
                g.status,
                g.created_at,
                GROUP_CONCAT(gp.player_name ORDER BY gp.joined_at) as players
            FROM games g
            LEFT JOIN game_players gp ON g.id = gp.game_id AND gp.is_active = true
            WHERE g.status IN ('waiting', 'race_selection')
            GROUP BY g.id, g.name, g.max_players, g.current_players, g.map_size, g.status, g.created_at
            ORDER BY g.created_at DESC
        `);

        return games.map(game => ({
            ...game,
            players: game.players ? game.players.split(',') : []
        }));

    } catch (error) {
        console.error('Error getting available games:', error);
        return [];
    }
}

async function setPlayerReady(gameId, playerName, ready) {
    try {
        // Update player ready status
        await db.query(
            'UPDATE game_players SET is_ready = ? WHERE game_id = ? AND player_name = ?',
            [ready, gameId, playerName]
        );

        // Prüfe ob alle Spieler bereit sind
        const players = await db.query(
            'SELECT COUNT(*) as total, SUM(is_ready) as ready_count FROM game_players WHERE game_id = ? AND is_active = true',
            [gameId]
        );

        const allReady = players[0].total > 1 && players[0].ready_count === players[0].total;

        return {
            success: true,
            allReady: allReady,
            readyCount: players[0].ready_count,
            totalPlayers: players[0].total
        };

    } catch (error) {
        console.error('Error setting player ready:', error);
        return { success: false, message: 'Fehler bei der Bereitschaftsanzeige' };
    }
}

async function startGame(gameId, playerName) {
    try {
        // Prüfe ob Spieler der Host ist
        const host = await db.query(
            'SELECT id FROM game_players WHERE game_id = ? AND player_name = ? AND is_host = true',
            [gameId, playerName]
        );

        if (host.length === 0) {
            return { success: false, message: 'Nur der Host kann das Spiel starten' };
        }

        // Prüfe ob alle Spieler bereit sind
        const players = await db.query(
            'SELECT COUNT(*) as total, SUM(is_ready) as ready_count FROM game_players WHERE game_id = ? AND is_active = true',
            [gameId]
        );

        if (players[0].total < 2) {
            return { success: false, message: 'Mindestens 2 Spieler erforderlich' };
        }

        if (players[0].ready_count !== players[0].total) {
            return { success: false, message: 'Nicht alle Spieler sind bereit' };
        }

        // Update game status to race selection
        await db.query(
            'UPDATE games SET status = "race_selection" WHERE id = ?',
            [gameId]
        );

        return {
            success: true,
            message: 'Spiel wird gestartet...'
        };

    } catch (error) {
        console.error('Error starting game:', error);
        return { success: false, message: 'Fehler beim Starten des Spiels' };
    }
}

async function leaveGame(gameId, playerName) {
    try {
        // Entferne Spieler aus dem Spiel
        await db.query(
            'UPDATE game_players SET is_active = false WHERE game_id = ? AND player_name = ?',
            [gameId, playerName]
        );

        // Zähle aktive Spieler
        const activePlayers = await db.query(
            'SELECT COUNT(*) as count FROM game_players WHERE game_id = ? AND is_active = true',
            [gameId]
        );

        const activePlayerCount = activePlayers[0].count;

        // Update current_players count
        await db.query(
            'UPDATE games SET current_players = ? WHERE id = ?',
            [activePlayerCount, gameId]
        );

        // Wenn keine aktiven Spieler mehr vorhanden sind, lösche das Spiel
        if (activePlayerCount === 0) {
            await db.query('DELETE FROM games WHERE id = ?', [gameId]);
            console.log(`Spiel ${gameId} wurde gelöscht (keine Spieler mehr)`);
            
            return {
                success: true,
                gameDeleted: true,
                message: 'Spiel verlassen und gelöscht'
            };
        } else {
            // Prüfe ob der Host das Spiel verlassen hat
            const hostExists = await db.query(
                'SELECT id FROM game_players WHERE game_id = ? AND is_host = true AND is_active = true',
                [gameId]
            );

            // Wenn kein Host mehr vorhanden ist, mache den ältesten aktiven Spieler zum Host
            if (hostExists.length === 0) {
                const oldestPlayer = await db.query(
                    'SELECT id FROM game_players WHERE game_id = ? AND is_active = true ORDER BY joined_at ASC LIMIT 1',
                    [gameId]
                );

                if (oldestPlayer.length > 0) {
                    await db.query(
                        'UPDATE game_players SET is_host = true WHERE id = ?',
                        [oldestPlayer[0].id]
                    );
                    console.log(`Neuer Host für Spiel ${gameId} bestimmt`);
                }
            }

            return {
                success: true,
                gameDeleted: false,
                message: 'Spiel verlassen',
                remainingPlayers: activePlayerCount
            };
        }

    } catch (error) {
        console.error('Error leaving game:', error);
        return { success: false, message: 'Fehler beim Verlassen des Spiels' };
    }
}

module.exports = {
    createGame,
    joinGame,
    getGamePlayers,
    getAvailableGames,
    setPlayerReady,
    startGame,
    leaveGame
};