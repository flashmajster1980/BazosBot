const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const SQLITE_FILE = path.join(__dirname, 'bot_database.sqlite');
const PG_CONNECTION_STRING = process.env.DATABASE_URL;

if (!PG_CONNECTION_STRING) {
    console.error('❌ Error: DATABASE_URL is missing in .env');
    console.error('   Please add the "External Database URL" from Render to your local .env file.');
    process.exit(1);
}

const sqliteDb = new sqlite3.Database(SQLITE_FILE, sqlite3.OPEN_READONLY);
const pgPool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    console.log('🚀 Starting migration from SQLite to PostgreSQL...');

    try {
        await migrateUsers();
        await migrateListings();
        await migratePriceHistory();
        console.log('\n✅ MIGRATION COMPLETED SUCCESSFULLY!');
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
    console.log(`   Found ${users.length} users in SQLite.`);

    for (const user of users) {
        try {
            await pgPool.query(
                `INSERT INTO users (username, password, subscription_status, created_at, google_id, avatar_url)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (username) DO NOTHING`,
                [
                    user.username,
                    user.password,
                    user.subscription_status || 'free',
                    user.created_at || new Date(),
                    user.google_id || null,
                    user.avatar_url || null
                ]
            );
        } catch (err) {
            console.error(`   ⚠️ Failed to user ${user.username}: ${err.message}`);
        }
    }
    console.log('   ✅ Users migrated.');
}

async function migrateListings() {
    console.log('\n🚗 Migrating Listings...');
    const listings = await getSqliteRows("SELECT * FROM listings");
    console.log(`   Found ${listings.length} listings in SQLite.`);

    let imported = 0;
    for (const l of listings) {
        try {
            // Convert SQLite 1/0 boolean to integer or keep as is (Postgres handles logic)
            // Ensure fields match schema
            await pgPool.query(
                `INSERT INTO listings (
                    id, url, portal, title, description, make, model, 
                    year, km, price, fuel, power, engine, equip_level, transmission, drive, 
                    vin, location, seller_name, phone, seller_type, 
                    scraped_at, updated_at, is_sold, deal_score, liquidity_score
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
                ON CONFLICT (id) DO UPDATE SET 
                    price = EXCLUDED.price, 
                    updated_at = EXCLUDED.updated_at`,
                [
                    l.id, l.url, l.portal, l.title, l.description, l.make, l.model,
                    l.year, l.km, l.price, l.fuel, l.power, l.engine, l.equip_level, l.transmission, l.drive,
                    l.vin, l.location, l.seller_name, l.phone, l.seller_type,
                    l.scraped_at || new Date(), l.updated_at || new Date(), l.is_sold || 0, l.deal_score, l.liquidity_score
                ]
            );
            imported++;
            if (imported % 100 === 0) process.stdout.write('.');
        } catch (err) {
            console.error(`\n   ⚠️ Failed to listing ${l.id}: ${err.message}`);
        }
    }
    console.log(`\n   ✅ Listings migrated (${imported}/${listings.length}).`);
}

async function migratePriceHistory() {
    console.log('\n📈 Migrating Price History...');
    const history = await getSqliteRows("SELECT * FROM price_history");
    console.log(`   Found ${history.length} history records in SQLite.`);

    let imported = 0;
    for (const h of history) {
        try {
            await pgPool.query(
                `INSERT INTO price_history (listing_id, price, checked_at)
                 VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`, // Assumes naive conflict check, or allow duplicates if IDs differ
                [h.listing_id, h.price, h.checked_at || new Date()]
            );
            imported++;
            if (imported % 100 === 0) process.stdout.write('.');
        } catch (err) {
            // Often fails if parent listing doesn't exist (shouldn't happen if migrateListings runs first)
            // console.error(`   ⚠️ History Error: ${err.message}`); 
        }
    }
    console.log(`\n   ✅ Price History migrated (${imported}/${history.length}).`);
}

migrate();
