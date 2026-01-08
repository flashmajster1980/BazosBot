const { Pool } = require('pg');

const PG_CONNECTION_STRING = "postgres://autoradar_db_user:sRG7iC36WUUuSyReeCgllrLf9RwxljGH@dpg-d5fsramuk2gs738vv2l0-a.frankfurt-postgres.render.com/autoradar_db";

const pool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
});

async function addColumns() {
    console.log('🏗 Manually adding missing columns to Postgres...');
    try {
        const columns = [
            'ALTER TABLE listings ADD COLUMN IF NOT EXISTS deal_type TEXT',
            'ALTER TABLE listings ADD COLUMN IF NOT EXISTS discount REAL',
            'ALTER TABLE listings ADD COLUMN IF NOT EXISTS corrected_median REAL',
            'ALTER TABLE listings ADD COLUMN IF NOT EXISTS ai_verdict TEXT',
            'ALTER TABLE listings ADD COLUMN IF NOT EXISTS ai_risk_level INTEGER'
        ];

        for (const sql of columns) {
            await pool.query(sql);
            console.log(`   Executed: ${sql}`);
        }
        console.log('✅ All columns added.');
    } catch (err) {
        console.error('❌ SQL Error:', err.message);
    } finally {
        await pool.end();
    }
}

addColumns();
