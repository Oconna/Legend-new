const db = require('../config/database');

class LobbyController {
    
    async createGame(gameName, maxPlayers, mapSize, playerName, socketId) {
        try {
            // Validierung
            if (!gameName || gameName.trim().length === 0) {
                return { success: false, message: 'Spielname erforderlich' };
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
                'INSERT INTO games (name, max_players, map_size, status) VALUES (?, ?, ?, ?)',
                [gameName.trim(), maxPlayers, mapSize, 'waiting']
            );

            const gameId = result.insertId;

            // Füge ersten Spieler hinzu (Host)
            await db.query(
                'INSERT INTO game_players (game_id, player_name, socket_id, is_host) VALUES (?, ?, ?, ?)',
                [gameId, playerName.trim(), socketId, true]
            );

            // Update current_players count
            await db.query(
                'UPDATE games SET current_players = 1 WHERE id = ?',
                [gameId]
            );

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
            return { success: false, message: 'Fehler beim Erstellen des Spiels' };
        }
    }

    async joinGame(gameId, playerName, socketId) {
        try {
            // Validierung
            if (!playerName || playerName.trim().length === 0) {
                return { success: false, message: 'Spielername erforderlich' };
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

            if (gameData.current_players >= gameData.max_players) {
                return { success: false, message: 'Spiel ist bereits voll' };
            }

            // Prüfe ob Spielername bereits in diesem Spiel existiert
            const existingPlayer = await db.query(
                'SELECT id FROM game_players WHERE game_id = ? AND player_name = ?',
                [gameId, playerName.trim()]
            );

            if (existingPlayer.length > 0) {
                return { success: false, message: 'Spielername bereits in diesem Spiel vergeben' };
            }

            // Füge Spieler hinzu
            await db.query(
                'INSERT INTO game_players (game_id, player_name, socket_id) VALUES (?, ?, ?)',
                [gameId, playerName.trim(), socketId]
            );

            // Update current_players count
            const newPlayerCount = gameData.current_players + 1;
            await db.query(
                'UPDATE games SET current_players = ? WHERE id = ?',
                [newPlayerCount, gameId]
            );

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
            return { success: false, message: 'Fehler beim Beitreten des Spiels' };
        }
    }

    async setPlayerReady(gameId, playerName, ready) {
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

    async startGame(gameId, playerName) {
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

    async getAvailableGames() {
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

    async getGamePlayers(gameId) {
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
}

module.exports = new LobbyController();