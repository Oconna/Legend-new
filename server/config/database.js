const mysql = require('mysql2/promise');
require('dotenv').config();

class Database {
    constructor() {
        this.pool = null;
        this.init();
    }

    async init() {
        try {
            this.pool = mysql.createPool({
                host: process.env.DB_HOST,
                port: process.env.DB_PORT || 3306,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
                acquireTimeout: 60000,
                timeout: 60000,
                enableKeepAlive: true,
                keepAliveInitialDelay: 0
            });

            // Test connection
            const connection = await this.pool.getConnection();
            console.log('✓ Datenbankverbindung erfolgreich hergestellt');
            connection.release();
        } catch (error) {
            console.error('✗ Datenbankverbindung fehlgeschlagen:', error.message);
            process.exit(1);
        }
    }

    async query(sql, params = []) {
        try {
            const [results] = await this.pool.execute(sql, params);
            return results;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }

    async getConnection() {
        return await this.pool.getConnection();
    }
}

module.exports = new Database();