const path = require('path');
require('dotenv').config();

// Abstraction layer for DB operations
const dbAsync = {
    run: null,
    get: null,
    all: null
};

let dbType = 'sqlite'; // 'sqlite' or 'postgres'

// Initialize Connection
if (process.env.DATABASE_URL) {
    // --- POSTGRESQL (Production) ---
    console.log('🐘 Connecting to PostgreSQL...');
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Required for Render
    });

    dbType = 'postgres';

    // Wrapper functions for Postgres
    dbAsync.run = async (sql, params = []) => {
        // Convert SQLite ? to Postgres $1, $2, etc.
        let i = 1;
        const pgSql = sql.replace(/\?/g, () => `$${i++}`);
        const res = await pool.query(pgSql, params);
        return { changes: res.rowCount, lastID: null }; // Postgres doesn't return lastID easily in generic Run
    };

    dbAsync.get = async (sql, params = []) => {
        let i = 1;
        const pgSql = sql.replace(/\?/g, () => `$${i++}`);
        const res = await pool.query(pgSql, params);
        return res.rows[0];
    };

    dbAsync.all = async (sql, params = []) => {
        let i = 1;
        const pgSql = sql.replace(/\?/g, () => `$${i++}`);
        const res = await pool.query(pgSql, params);
        return res.rows;
    };

    initPostgresSchema(pool);

} else {
    // --- SQLITE (Local Development) ---
    console.log('📂 Connecting to SQLite (Local)...');
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(path.join(__dirname, 'bot_database.sqlite'));

    dbType = 'sqlite';

    // Promisify SQLite functions
    dbAsync.run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    dbAsync.get = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    dbAsync.all = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    initSQLiteSchema(db);
}


// --- SCHEMA INITIALIZATION ---

function initSQLiteSchema(db) {
    db.serialize(() => {
        // Listings Table
        db.run(`CREATE TABLE IF NOT EXISTS listings (
            id TEXT PRIMARY KEY,
            url TEXT,
            portal TEXT,
            title TEXT,
            description TEXT,
            make TEXT,
            model TEXT,
            year INTEGER,
            km INTEGER,
            price REAL,
            fuel TEXT,
            power INTEGER,
            engine TEXT,
            equip_level TEXT,
            transmission TEXT,
            drive TEXT,
            vin TEXT,
            location TEXT,
            seller_name TEXT,
            phone TEXT,
            seller_type TEXT,
            scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_sold INTEGER DEFAULT 0,
            deal_score REAL,
            liquidity_score REAL
        )`);

        // Price History
        db.run(`CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id TEXT,
            price REAL,
            checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(listing_id) REFERENCES listings(id)
        )`);

        // Users
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            subscription_status TEXT DEFAULT 'free',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            google_id TEXT UNIQUE,
            avatar_url TEXT
        )`);

        console.log('✅ SQLite schema initialized.');
    });
}

async function initPostgresSchema(pool) {
    try {
        // Listings
        await pool.query(`CREATE TABLE IF NOT EXISTS listings (
            id TEXT PRIMARY KEY,
            url TEXT,
            portal TEXT,
            title TEXT,
            description TEXT,
            make TEXT,
            model TEXT,
            year INTEGER,
            km INTEGER,
            price REAL,
            fuel TEXT,
            power INTEGER,
            engine TEXT,
            equip_level TEXT,
            transmission TEXT,
            drive TEXT,
            vin TEXT,
            location TEXT,
            seller_name TEXT,
            phone TEXT,
            seller_type TEXT,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_sold INTEGER DEFAULT 0,
            deal_score REAL,
            liquidity_score REAL
        )`);

        // Price History
        await pool.query(`CREATE TABLE IF NOT EXISTS price_history (
            id SERIAL PRIMARY KEY,
            listing_id TEXT,
            price REAL,
            checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (listing_id) REFERENCES listings(id)
        )`);

        // Users
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            subscription_status TEXT DEFAULT 'free',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            google_id TEXT UNIQUE,
            avatar_url TEXT
        )`);

        console.log('✅ PostgreSQL schema initialized.');
    } catch (err) {
        console.error('❌ Error initializing Postgres schema:', err.message);
    }
}

// Helpers
async function identifySellerType(sellerName, requestDb) {
    if (!sellerName) return 'Private';
    const lower = sellerName.toLowerCase();

    // Keyword heuristics
    if (lower.includes('auto') || lower.includes('car') || lower.includes('s.r.o') || lower.includes('gmbh')) {
        return 'Dealer';
    }

    // DB Check (if user has many listings)
    try {
        const result = await requestDb.get(`SELECT COUNT(*) as count FROM listings WHERE seller_name = ?`, [sellerName]);
        if (result && result.count > 3) return 'Dealer';
    } catch (e) { /* ignore */ }

    return 'Private';
}

async function upsertListing(listing) {
    try {
        const existing = await dbAsync.get('SELECT * FROM listings WHERE id = ?', [listing.id]);

        if (existing) {
            // Price Change Logic
            if (existing.price !== listing.price) {
                console.log(`📉 Price change for ${listing.id}: ${existing.price} -> ${listing.price}`);
                await dbAsync.run(
                    'INSERT INTO price_history (listing_id, price) VALUES (?, ?)',
                    [listing.id, listing.price]
                );
            }
            // Update essentials
            await dbAsync.run(
                `UPDATE listings SET 
                    price = ?, 
                    updated_at = ${dbType === 'postgres' ? 'NOW()' : "datetime('now')"},
                    is_sold = 0
                WHERE id = ?`,
                [listing.price, listing.id]
            );
        } else {
            // New Listing
            const sellerType = await identifySellerType(listing.seller_name, dbAsync);

            // Explicit Column List for safety
            await dbAsync.run(
                `INSERT INTO listings (
                    id, url, portal, title, description, make, model, 
                    year, km, price, fuel, power, engine, equip_level, transmission, drive, 
                    vin, location, seller_name, phone, seller_type, deal_score, liquidity_score
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    listing.id, listing.url, listing.portal, listing.title, listing.description || null,
                    listing.make, listing.model, listing.year, listing.km, listing.price,
                    listing.fuel || null, listing.power || null, listing.engine || null, listing.equip_level || null,
                    listing.transmission || null, listing.drive || null, listing.vin || null, listing.location || null,
                    listing.seller_name || null, listing.phone || null, sellerType,
                    listing.deal_score || null, listing.liquidity_score || null
                ]
            );

            // Init history
            await dbAsync.run('INSERT INTO price_history (listing_id, price) VALUES (?, ?)', [listing.id, listing.price]);
        }
    } catch (err) {
        console.error(`❌ DB Upsert Error (${listing.id}):`, err.message);
    }
}

module.exports = { dbAsync, upsertListing, identifySellerType };
