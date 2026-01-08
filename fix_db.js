const { Pool } = require('pg');
require('dotenv').config();

const PG_CONNECTION_STRING = "postgres://autoradar_db_user:sRG7iC36WUUuSyReeCgllrLf9RwxljGH@dpg-d5fsramuk2gs738vv2l0-a.frankfurt-postgres.render.com/autoradar_db";

const pool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
});

async function runFix() {
    console.log('🛠 Starting DB Fix...');
    try {
        // 1. Upgrade everyone to premium
        const resUsers = await pool.query("UPDATE users SET subscription_status = 'premium'");
        console.log(`✅ Fixed ${resUsers.rowCount} user(s) to Premium.`);

        // 2. Check listing count and golden deals
        const resListings = await pool.query("SELECT COUNT(*) as count, SUM(CASE WHEN deal_type = 'GOLDEN DEAL' THEN 1 ELSE 0 END) as golden FROM listings");
        console.log(`📊 Statistics from Postgres:`);
        console.log(`   - Total Listings: ${resListings.rows[0].count}`);
        console.log(`   - Golden Deals: ${resListings.rows[0].golden}`);

    } catch (err) {
        console.error('❌ Error during fix:', err.message);
    } finally {
        await pool.end();
    }
}

runFix();
