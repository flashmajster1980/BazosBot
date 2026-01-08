const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'bot_database.sqlite');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
    } else {
        console.log('✅ Connected to SQLite database.');
        initializeSchema();
    }
});

function initializeSchema() {
    db.serialize(() => {
        // Table listings: Všetky údaje o inzeráte
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
            price INTEGER,
            fuel TEXT,
            power TEXT,
            engine TEXT,
            equip_level TEXT,
            transmission TEXT,
            drive TEXT,
            vin TEXT,
            location TEXT,
            seller_name TEXT,
            phone TEXT,
            seller_type TEXT,
            deal_score REAL,
            liquidity_score REAL,
            risk_score INTEGER DEFAULT 0,
            ai_verdict TEXT,
            ai_risk_level INTEGER,
            is_sold INTEGER DEFAULT 0,
            sold_at DATETIME,
            last_checked DATETIME,
            scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Table price_history: Ukladanie zmien ceny
        db.run(`CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id TEXT,
            price INTEGER,
            checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (listing_id) REFERENCES listings (id)
        )`);

        // Table market_stats: Denný medián trhu pre modely
        db.run(`CREATE TABLE IF NOT EXISTS market_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT,
            year INTEGER,
            median_price REAL,
            date DATE DEFAULT CURRENT_DATE
        )`);

        // Table users: Používatelia a predplatné
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            subscription_status TEXT DEFAULT 'basic',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        console.log('✅ Database schema initialized.');
    });
}

/**
 * Promisified database operations
 */
const dbAsync = {
    run: (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    })
};

const { extractMakeModel } = require('./utils');

async function identifySellerType(sellerName, phone, dbAsync) {
    if (!phone && !sellerName) return 'Neznámy';

    // 1. Check database for other cars under the same phone or name
    let count = 0;
    if (phone) {
        const result = await dbAsync.get('SELECT COUNT(*) as cnt FROM listings WHERE phone = ?', [phone]);
        count = result.cnt;
    } else if (sellerName) {
        const result = await dbAsync.get('SELECT COUNT(*) as cnt FROM listings WHERE seller_name = ?', [sellerName]);
        count = result.cnt;
    }

    if (count >= 3) {
        return '🏢 Bazár / Predajca';
    }

    // 2. Name check for civilian-like names
    const civilianNames = ['peter', 'jozef', 'marek', 'michal', 'jan', 'pavol', 'martin', 'stefan', 'ivan', 'igor', 'lucia', 'maria', 'jana'];
    const lowerName = (sellerName || '').toLowerCase();

    if (civilianNames.some(name => lowerName.includes(name))) {
        return '👤 Súkromná osoba';
    }

    return count > 1 ? '🏢 Malý predajca' : '👤 Súkromná osoba';
}

/**
 * Main logic to save or update a listing with price history
 */
async function upsertListing(listing) {
    try {
        // Extract make/model if missing
        if (!listing.make || !listing.model) {
            const { make, model } = extractMakeModel(listing.title || '');
            listing.make = listing.make || make;
            listing.model = listing.model || model;
        }

        const existing = await dbAsync.get('SELECT price, id FROM listings WHERE id = ?', [listing.id]);

        if (existing) {
            // Check if price changed
            if (existing.price !== listing.price) {
                console.log(`💰 Price change for [${listing.id}]: ${existing.price}€ -> ${listing.price}€`);

                // Update listing price and updated_at
                await dbAsync.run(
                    `UPDATE listings SET 
                        price = ?, 
                        deal_score = ?, 
                        liquidity_score = ?, 
                        engine = ?,
                        equip_level = ?,
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?`,
                    [listing.price, listing.deal_score || null, listing.liquidity_score || null, listing.engine || null, listing.equip_level || null, listing.id]
                );

                // Add to history
                await dbAsync.run(
                    'INSERT INTO price_history (listing_id, price) VALUES (?, ?)',
                    [listing.id, listing.price]
                );
            } else {
                // Update listing price and updated_at
                await dbAsync.run(
                    `UPDATE listings SET 
                        price = ?, 
                        deal_score = ?, 
                        liquidity_score = ?, 
                        engine = ?,
                        equip_level = ?,
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?`,
                    [listing.price, listing.deal_score || null, listing.liquidity_score || null, listing.engine || null, listing.equip_level || null, listing.id]
                );
            }
        } else {
            // Identify seller type
            const sellerType = await identifySellerType(listing.seller_name, listing.phone, dbAsync);
            listing.seller_type = listing.seller_type || sellerType;

            // Create new record
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
                    listing.seller_name || null, listing.phone || null, listing.seller_type || null,
                    listing.deal_score || null, listing.liquidity_score || null
                ]
            );

            // Add first entry to history
            await dbAsync.run(
                'INSERT INTO price_history (listing_id, price) VALUES (?, ?)',
                [listing.id, listing.price]
            );

            console.log(`✨ NEW record in DB: [${listing.id}] ${listing.make} ${listing.model}`);
        }
    } catch (err) {
        console.error(`❌ Error in upsertListing for ${listing.id}:`, err.message);
    }
}

async function saveMarketStat(model, year, medianPrice) {
    try {
        // Avoid duplicate entries for same day
        const today = new Date().toISOString().split('T')[0];
        const existing = await dbAsync.get(
            'SELECT id FROM market_stats WHERE model = ? AND year = ? AND date = ?',
            [model, year, today]
        );

        if (existing) {
            await dbAsync.run(
                'UPDATE market_stats SET median_price = ? WHERE id = ?',
                [medianPrice, existing.id]
            );
        } else {
            await dbAsync.run(
                'INSERT INTO market_stats (model, year, median_price, date) VALUES (?, ?, ?, ?)',
                [model, year, medianPrice, today]
            );
        }
    } catch (err) {
        console.error(`❌ Error in saveMarketStat:`, err.message);
    }
}

module.exports = {
    db,
    dbAsync,
    upsertListing,
    saveMarketStat
};
