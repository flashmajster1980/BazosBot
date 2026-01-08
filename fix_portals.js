const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'bot_database.sqlite'));

db.serialize(() => {
    console.log('--- Fixing Missing Portals based on URL ---');

    const updates = [
        { name: 'Bazos', pattern: '%bazos.sk%' },
        { name: 'Autobazar.eu', pattern: '%autobazar.eu%' },
        { name: 'Autobazar.sk', pattern: '%autobazar.sk%' },
        { name: 'Autovia.sk', pattern: '%autovia.sk%' }
    ];

    let completed = 0;

    updates.forEach(up => {
        db.run(
            `UPDATE listings SET portal = ? WHERE portal IS NULL AND url LIKE ?`,
            [up.name, up.pattern],
            function (err) {
                if (err) console.error(`Error updating ${up.name}:`, err.message);
                else console.log(`✅ Updated ${this.changes} listings for ${up.name}`);

                completed++;
                if (completed === updates.length) {
                    console.log('--- Done ---');
                    db.close();
                }
            }
        );
    });
});
