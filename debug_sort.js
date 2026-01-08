const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('bot_database.sqlite');

const sort = 'best';
let orderBy = 'ORDER BY scraped_at DESC';
if (sort === 'best') orderBy = "ORDER BY CASE WHEN deal_type = 'GOLDEN DEAL' THEN 0 ELSE 1 END, discount DESC";

db.all(`SELECT title, deal_type, discount FROM listings WHERE is_sold = 0 ${orderBy} LIMIT 10`, (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.table(rows);
    }
    db.close();
});
