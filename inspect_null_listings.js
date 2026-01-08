const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'bot_database.sqlite'));

db.serialize(() => {
    console.log('--- Inspecting Unknown Portals ---');
    db.all("SELECT id, portal, title, url, scraped_at FROM listings WHERE portal IS NULL OR portal NOT IN ('Bazos', 'Autobazar.eu', 'Autobazar.sk', 'Autovia.sk') LIMIT 20", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        if (rows.length === 0) {
            console.log("No unknown portal listings found (maybe they are just NULL?).");
        }
        rows.forEach(r => {
            console.log(`[${r.portal || 'NULL'}] ${r.title} (${r.url ? r.url.substring(0, 50) + '...' : 'No URL'}) - ${r.scraped_at}`);
        });
        db.close();
    });
});
