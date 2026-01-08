const { Pool } = require('pg');
const PG_CONNECTION_STRING = "postgres://autoradar_db_user:sRG7iC36WUUuSyReeCgllrLf9RwxljGH@dpg-d5fsramuk2gs738vv2l0-a.frankfurt-postgres.render.com/autoradar_db";
const pool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
});
async function run() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS market_stats (
            id SERIAL PRIMARY KEY,
            model TEXT,
            year INTEGER,
            median_price REAL,
            count INTEGER,
            date DATE DEFAULT CURRENT_DATE,
            UNIQUE(model, year, date)
        )`);
        console.log('✅ market_stats table created');
    } catch (e) { console.error(e); }
    process.exit(0);
}
run();
