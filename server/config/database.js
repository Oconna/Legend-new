const mysql = require('mysql2/promise');
require('dotenv').config();

class Database {
    constructor() {
        this.pool = null;
        this.init();
    }

    async init() {
        try {
            console.log('Initialisiere Datenbankverbindung...');
            console.log('DB Config:', {
                host: process.env.DB_HOST,
                port: process.env.DB_PORT || 3306,
                user: process.env.DB_USER,
                database: process.env.DB_NAME
            });

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
                keepAliveInitialDelay: 0,
                reconnect: true,
                idleTimeout: 60000,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Test connection
            const connection = await this.pool.getConnection();
            console.log('✓ Datenbankverbindung erfolgreich hergestellt');
            
            // Test query
            const [rows] = await connection.execute('SELECT 1 as test');
            console.log('✓ Datenbanktest erfolgreich:', rows);
            
            connection.release();
        } catch (error) {
            console.error('✗ Datenbankverbindung fehlgeschlagen:');
            console.error('Error Code:', error.code);
            console.error('Error Message:', error.message);
            console.error('Error Stack:', error.stack);
            
            // Don't exit in production, just log the error
            if (process.env.NODE_ENV !== 'production') {
                process.exit(1);
            }
        }
    }

    async query(sql, params = []) {
        try {
            if (!this.pool) {
                throw new Error('Database pool not initialized');
            }
            
            console.log('Executing query:', sql, 'with params:', params);
            const [results] = await this.pool.execute(sql, params);
            console.log('Query results:', results);
            return results;
        } catch (error) {
            console.error('Database query error:');
            console.error('SQL:', sql);
            console.error('Params:', params);
            console.error('Error:', error);
            throw error;
        }
    }

    async getConnection() {
        if (!this.pool) {
            throw new Error('Database pool not initialized');
        }
        return await this.pool.getConnection();
    }
}

module.exports = new Database();