const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const SQLITE_FILE = path.join(__dirname, 'bot_database.sqlite');
const PG_CONNECTION_STRING = process.env.DATABASE_URL;

if (!PG_CONNECTION_STRING) {
    console.error('❌ Error: DATABASE_URL is missing in .env');
    process.exit(1);
}

const sqliteDb = new sqlite3.Database(SQLITE_FILE, sqlite3.OPEN_READONLY);
const pgPool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    console.log('🚀 Starting deep migration with new schema...');

    try {
        await migrateUsers();
        await migrateListings();
        console.log('\n✅ DEEP MIGRATION COMPLETED!');
    } catch (err) {
        console.error('\n❌ Migration Failed:', err);
    } finally {
        sqliteDb.close();
        await pgPool.end();
    }
}

function getSqliteRows(query) {
    return new Promise((resolve, reject) => {
        sqliteDb.all(query, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function migrateUsers() {
    console.log('\n👤 Migrating Users...');
    const users = await getSqliteRows("SELECT * FROM users");
    for (const user of users) {
        try {
            await pgPool.query(
                `INSERT INTO users (username, password, subscription_status, created_at, google_id, avatar_url)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (username) DO UPDATE SET subscription_status = EXCLUDED.subscription_status, google_id = EXCLUDED.google_id`,
                [user.username, user.password, user.subscription_status || 'free', user.created_at || new Date(), user.google_id || null, user.avatar_url || null]
            );
        } catch (err) { }
    }
}

async function migrateListings() {
    console.log('\n🚗 Migrating Listings (Deep Mode)...');
    const listings = await getSqliteRows("SELECT * FROM listings");
    console.log(`   Found ${listings.length} items to process.`);

    const cleanInt = (val) => {
        if (!val) return null;
        if (typeof val === 'number') return val;
        const cleaned = val.toString().replace(/\D/g, '');
        return cleaned ? parseInt(cleaned) : null;
    };

    let count = 0;
    for (const l of listings) {
        try {
            await pgPool.query(
                `INSERT INTO listings (
                    id, url, portal, title, description, make, model, 
                    year, km, price, fuel, power, engine, equip_level, transmission, drive, 
                    vin, location, seller_name, phone, seller_type, 
                    scraped_at, updated_at, is_sold, deal_score, liquidity_score,
                    deal_type, discount, corrected_median, ai_verdict, ai_risk_level
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
                ON CONFLICT (id) DO UPDATE SET 
                    deal_type = EXCLUDED.deal_type, 
                    discount = EXCLUDED.discount,
                    corrected_median = EXCLUDED.corrected_median,
                    deal_score = EXCLUDED.deal_score,
                    liquidity_score = EXCLUDED.liquidity_score,
                    price = EXCLUDED.price`,
                [
                    l.id, l.url, l.portal, l.title, l.description, l.make, l.model,
                    cleanInt(l.year), cleanInt(l.km), l.price, l.fuel, cleanInt(l.power), l.engine, l.equip_level, l.transmission, l.drive,
                    l.vin, l.location, l.seller_name, l.phone, l.seller_type,
                    l.scraped_at || new Date(), l.updated_at || new Date(), l.is_sold || 0, l.deal_score, l.liquidity_score,
                    l.deal_type || null, l.discount || null, l.corrected_median || null, l.ai_verdict || null, l.ai_risk_level || null
                ]
            );
            count++;
            if (count % 100 === 0) process.stdout.write('.');
        } catch (err) {
            // console.error(`Error with ${l.id}: ${err.message}`);
        }
    }
}

migrate();
