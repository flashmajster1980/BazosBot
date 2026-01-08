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
        let i = 1;
        const pgSql = sql.replace(/\?/g, () => `$${i++}`);
        const res = await pool.query(pgSql, params);
        return { changes: res.rowCount, lastID: null };
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


async function initSQLiteSchema(db) {
    db.serialize(() => {
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
            liquidity_score REAL,
            deal_type TEXT,
            discount REAL,
            corrected_median REAL,
            ai_verdict TEXT,
            ai_risk_level INTEGER
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id TEXT,
            price REAL,
            checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(listing_id) REFERENCES listings(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            subscription_status TEXT DEFAULT 'free',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            google_id TEXT UNIQUE,
            avatar_url TEXT
        )`);
    });
}

async function initPostgresSchema(pool) {
    try {
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
            liquidity_score REAL,
            deal_type TEXT,
            discount REAL,
            corrected_median REAL,
            ai_verdict TEXT,
            ai_risk_level INTEGER
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS price_history (
            id SERIAL PRIMARY KEY,
            listing_id TEXT,
            price REAL,
            checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (listing_id) REFERENCES listings(id)
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            subscription_status TEXT DEFAULT 'free',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            google_id TEXT UNIQUE,
            avatar_url TEXT
        )`);
        console.log('✅ PostgreSQL schema fully initialized.');
    } catch (err) {
        console.error('❌ Error initializing Postgres schema:', err.message);
    }
}

async function identifySellerType(sellerName, requestDb) {
    if (!sellerName) return 'Private';
    const lower = sellerName.toLowerCase();
    if (lower.includes('auto') || lower.includes('car') || lower.includes('s.r.o') || lower.includes('gmbh')) return 'Dealer';
    try {
        const result = await requestDb.get(`SELECT COUNT(*) as count FROM listings WHERE seller_name = ?`, [sellerName]);
        if (result && result.count > 3) return 'Dealer';
    } catch (e) { }
    return 'Private';
}

async function upsertListing(listing) {
    try {
        const existing = await dbAsync.get('SELECT * FROM listings WHERE id = ?', [listing.id]);

        if (existing) {
            if (existing.price !== listing.price) {
                await dbAsync.run('INSERT INTO price_history (listing_id, price) VALUES (?, ?)', [listing.id, listing.price]);
            }
            await dbAsync.run(
                `UPDATE listings SET 
                    price = ?, 
                    updated_at = ${dbType === 'postgres' ? 'NOW()' : "datetime('now')"},
                    is_sold = 0,
                    deal_score = ?,
                    liquidity_score = ?,
                    deal_type = ?,
                    discount = ?,
                    corrected_median = ?,
                    ai_verdict = ?,
                    ai_risk_level = ?
                WHERE id = ?`,
                [listing.price, listing.deal_score, listing.liquidity_score, listing.deal_type, listing.discount, listing.corrected_median, listing.ai_verdict, listing.ai_risk_level, listing.id]
            );
        } else {
            const sellerType = await identifySellerType(listing.seller_name, dbAsync);
            await dbAsync.run(
                `INSERT INTO listings (
                    id, url, portal, title, description, make, model, 
                    year, km, price, fuel, power, engine, equip_level, transmission, drive, 
                    vin, location, seller_name, phone, seller_type, deal_score, liquidity_score,
                    deal_type, discount, corrected_median, ai_verdict, ai_risk_level
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    listing.id, listing.url, listing.portal, listing.title, listing.description || null,
                    listing.make, listing.model, listing.year, listing.km, listing.price,
                    listing.fuel || null, listing.power || null, listing.engine || null, listing.equip_level || null,
                    listing.transmission || null, listing.drive || null, listing.vin || null, listing.location || null,
                    listing.seller_name || null, listing.phone || null, sellerType,
                    listing.deal_score || null, listing.liquidity_score || null,
                    listing.deal_type || null, listing.discount || null, listing.corrected_median || null,
                    listing.ai_verdict || null, listing.ai_risk_level || null
                ]
            );
            await dbAsync.run('INSERT INTO price_history (listing_id, price) VALUES (?, ?)', [listing.id, listing.price]);
        }
    } catch (err) {
        console.error(`❌ DB Upsert Error (${listing.id}):`, err.message);
    }
}

module.exports = { dbAsync, upsertListing, identifySellerType };
