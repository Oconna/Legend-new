// server/config/database.js - Verbesserte Konfiguration für Railway MySQL

const mysql = require('mysql2/promise');

class Database {
    constructor() {
        this.pool = null;
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 5;
        this.retryDelay = 1000; // 1 Sekunde
        
        this.init();
        this.setupHealthCheck();
    }

    init() {
        try {
            // Verbesserte Pool-Konfiguration für Railway
            this.pool = mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'strategy_game',
                
                // ✅ ERWEITERTE POOL-KONFIGURATION
                connectionLimit: 5, // Reduziert für Railway
                acquireTimeout: 60000, // 60 Sekunden
                timeout: 60000,
                reconnect: true,
                idleTimeout: 300000, // 5 Minuten
                
                // ✅ RAILWAY-SPEZIFISCHE EINSTELLUNGEN
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                supportBigNumbers: true,
                bigNumberStrings: true,
                dateStrings: true,
                
                // ✅ VERBINDUNGS-HANDLING
                handleDisconnects: true,
                reconnect: true,
                
                // ✅ ERWEITERTE TIMEOUTS
                socketPath: undefined,
                keepAliveInitialDelay: 0,
                enableKeepAlive: true,
                
                // ✅ ERROR HANDLING
                multipleStatements: false,
                trace: false,
                debug: false
            });

            // Pool Events
            this.pool.on('connection', (connection) => {
                console.log('📊 New database connection established');
                this.isConnected = true;
                this.connectionAttempts = 0;
            });

            this.pool.on('error', (error) => {
                console.error('❌ Database pool error:', error);
                this.isConnected = false;
                
                if (error.code === 'PROTOCOL_CONNECTION_LOST' || 
                    error.code === 'ECONNRESET' ||
                    error.code === 'ETIMEDOUT') {
                    console.log('🔄 Attempting to reconnect to database...');
                    this.handleReconnect();
                }
            });

            this.pool.on('acquire', (connection) => {
                console.log('🔗 Connection %d acquired', connection.threadId);
            });

            this.pool.on('release', (connection) => {
                console.log('🔓 Connection %d released', connection.threadId);
            });

            console.log('✅ Database pool initialized');
            
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            this.handleReconnect();
        }
    }

    // ✅ VERBESSERTE QUERY-METHODE MIT RETRY-LOGIK
    async query(sql, params = []) {
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                console.log('Executing query:', sql, 'with params:', params);
                
                // Pool-Status prüfen
                if (!this.pool) {
                    throw new Error('Database pool not initialized');
                }
                
                const [results] = await this.pool.execute(sql, params);
                
                console.log(`✅ Query executed successfully. Rows affected: ${results.affectedRows || results.length}`);
                
                return results;
                
            } catch (error) {
                retryCount++;
                
                console.error('Database query error:');
                console.error('SQL:', sql);
                console.error('Params:', params);
                console.error('Error:', error);
                console.error('Retry attempt:', retryCount, 'of', maxRetries);
                
                // Bei Verbindungsfehlern automatisch retry
                if (this.shouldRetry(error) && retryCount < maxRetries) {
                    console.log(`🔄 Retrying query in ${this.retryDelay}ms...`);
                    await this.sleep(this.retryDelay * retryCount); // Exponential backoff
                    
                    // Pool neu initialisieren bei schwerwiegenden Fehlern
                    if (error.code === 'ECONNRESET' || 
                        error.code === 'PROTOCOL_CONNECTION_LOST' ||
                        error.code === 'ETIMEDOUT') {
                        await this.recreatePool();
                    }
                    
                    continue;
                }
                
                // Nach allen Retry-Versuchen immer noch Fehler
                throw error;
            }
        }
    }

    // ✅ HILFSMETHODE: Sollte Retry versucht werden?
    shouldRetry(error) {
        const retryableCodes = [
            'ECONNRESET',
            'PROTOCOL_CONNECTION_LOST', 
            'ETIMEDOUT',
            'ENOTFOUND',
            'ENETUNREACH',
            'ER_LOCK_WAIT_TIMEOUT'
        ];
        
        return retryableCodes.includes(error.code);
    }

    // ✅ POOL NEU ERSTELLEN
    async recreatePool() {
        try {
            console.log('🔄 Recreating database pool...');
            
            if (this.pool) {
                await this.pool.end();
                this.pool = null;
            }
            
            // Kurz warten bevor Neuverbindung
            await this.sleep(2000);
            
            this.init();
            
            // Test-Query um Verbindung zu prüfen
            await this.testConnection();
            
        } catch (error) {
            console.error('❌ Failed to recreate pool:', error);
        }
    }

    // ✅ RECONNECT-HANDLER
    async handleReconnect() {
        if (this.connectionAttempts >= this.maxRetries) {
            console.error('❌ Max reconnection attempts reached. Giving up.');
            return;
        }

        this.connectionAttempts++;
        console.log(`🔄 Reconnection attempt ${this.connectionAttempts}/${this.maxRetries}`);
        
        const delay = this.retryDelay * this.connectionAttempts;
        await this.sleep(delay);
        
        await this.recreatePool();
    }

    // ✅ VERBINDUNGS-TEST
    async testConnection() {
        try {
            const result = await this.query('SELECT 1 as test');
            console.log('✅ Database connection test successful');
            this.isConnected = true;
            return true;
        } catch (error) {
            console.error('❌ Database connection test failed:', error);
            this.isConnected = false;
            return false;
        }
    }

    // ✅ HEALTH-CHECK (alle 5 Minuten)
    setupHealthCheck() {
        setInterval(async () => {
            try {
                await this.testConnection();
            } catch (error) {
                console.error('❌ Health check failed:', error);
                this.handleReconnect();
            }
        }, 300000); // 5 Minuten
    }

    // ✅ TRANSACTION SUPPORT
    async transaction(callback) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            const result = await callback(connection);
            
            await connection.commit();
            return result;
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // ✅ ERWEITERTE QUERY-METHODEN
    async queryWithConnection(sql, params = []) {
        const connection = await this.pool.getConnection();
        try {
            const [results] = await connection.execute(sql, params);
            return results;
        } finally {
            connection.release();
        }
    }

    // ✅ BATCH INSERT
    async batchInsert(table, columns, rows, chunkSize = 100) {
        if (!rows || rows.length === 0) return [];
        
        const results = [];
        
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
            const values = chunk.flat();
            
            const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`;
            const result = await this.query(sql, values);
            results.push(result);
        }
        
        return results;
    }

    // ✅ SAFE SELECT
    async selectOne(sql, params = []) {
        const results = await this.query(sql, params);
        return results.length > 0 ? results[0] : null;
    }

    async selectMany(sql, params = []) {
        return await this.query(sql, params);
    }

    // ✅ HILFSFUNKTIONEN
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ✅ POOL-STATUS
    getPoolStatus() {
        if (!this.pool) {
            return { status: 'disconnected', pool: null };
        }
        
        return {
            status: this.isConnected ? 'connected' : 'disconnected',
            pool: {
                allConnections: this.pool._allConnections ? this.pool._allConnections.length : 0,
                freeConnections: this.pool._freeConnections ? this.pool._freeConnections.length : 0,
                connectionQueue: this.pool._connectionQueue ? this.pool._connectionQueue.length : 0
            },
            attempts: this.connectionAttempts
        };
    }

    // ✅ GRACEFUL SHUTDOWN
    async close() {
        try {
            if (this.pool) {
                console.log('🔐 Closing database pool...');
                await this.pool.end();
                this.pool = null;
                this.isConnected = false;
                console.log('✅ Database pool closed successfully');
            }
        } catch (error) {
            console.error('❌ Error closing database pool:', error);
        }
    }
}

// ✅ SINGLETON INSTANCE
const database = new Database();

// ✅ GRACEFUL SHUTDOWN HANDLERS
process.on('SIGINT', async () => {
    console.log('🔐 SIGINT received, closing database...');
    await database.close();
});

process.on('SIGTERM', async () => {
    console.log('🔐 SIGTERM received, closing database...');
    await database.close();
});

module.exports = database;