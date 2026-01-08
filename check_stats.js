const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'bot_database.sqlite'));

db.serialize(() => {
    console.log('--- Štatistika databázy ---');
    db.get("SELECT COUNT(*) as count FROM listings", (err, row) => {
        console.log(`Celkový počet inzerátov: ${row.count}`);
    });

    db.get("SELECT COUNT(*) as count FROM listings WHERE location IS NULL OR location LIKE '%kraj%'", (err, row) => {
        console.log(`Chýbajúca/nepresná lokalita: ${row.count}`);
    });

    db.get("SELECT COUNT(*) as count FROM listings WHERE year IS NULL", (err, row) => {
        console.log(`Chýbajúci rok: ${row.count}`);
    });

    db.get("SELECT COUNT(*) as count FROM listings WHERE km IS NULL", (err, row) => {
        console.log(`Chýbajúce kilometre: ${row.count}`);
    });

    db.get("SELECT COUNT(*) as count FROM listings WHERE seller_type IS NULL OR seller_type = 'Neznámy'", (err, row) => {
        console.log(`Neidentifikovaný predajca: ${row.count}`);
    });

    console.log('\n--- Nedávna aktivita ---');
    db.get("SELECT COUNT(*) as count FROM listings WHERE scraped_at > datetime('now', '-24 hours')", (err, row) => {
        console.log(`Inzeráty pridané/aktualizované za 24h: ${row.count}`);
    });

    console.log('\n--- Rozdelenie podľa portálov ---');
    db.all("SELECT portal, COUNT(*) as count FROM listings GROUP BY portal", (err, rows) => {
        rows.forEach(r => console.log(`${r.portal}: ${r.count}`));
        db.close();
    });
});
