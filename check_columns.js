const { Pool } = require('pg');
const PG_CONNECTION_STRING = "postgres://autoradar_db_user:sRG7iC36WUUuSyReeCgllrLf9RwxljGH@dpg-d5fsramuk2gs738vv2l0-a.frankfurt-postgres.render.com/autoradar_db";
const pool = new Pool({
    connectionString: PG_CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
});
async function run() {
    try {
        const res = await pool.query("SELECT column_name, ordinal_position FROM information_schema.columns WHERE table_name = 'listings' ORDER BY ordinal_position");
        console.log(res.rows);
    } catch (e) { console.error(e); }
    process.exit(0);
}
run();
