const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'bot_database.sqlite'));

db.serialize(() => {
    console.log('--- Inspecting "Missing" Locations ---');
    // Using the same criteria as check_stats.js
    db.all("SELECT id, portal, location, url FROM listings WHERE location IS NULL OR location LIKE '%kraj%' LIMIT 20", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        rows.forEach(r => {
            console.log(`[${r.portal}] Loc: '${r.location}' | URL: ${r.url}`);
        });
        db.close();
    });
});
