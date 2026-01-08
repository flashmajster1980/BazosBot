const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'bot_database.sqlite'));

const columnsToAdd = [
    { name: 'deal_score', type: 'REAL' },
    { name: 'liquidity_score', type: 'REAL' },
    { name: 'risk_score', type: 'INTEGER' },
    { name: 'deal_type', type: 'TEXT' },
    { name: 'discount', type: 'REAL' },
    { name: 'corrected_median', type: 'REAL' },
    { name: 'negotiation_score', type: 'REAL' }
];

db.serialize(() => {
    columnsToAdd.forEach(column => {
        db.run(`ALTER TABLE listings ADD COLUMN ${column.name} ${column.type}`, (err) => {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log(`ℹ️ Column ${column.name} already exists.`);
                } else {
                    console.error(`❌ Error adding ${column.name}:`, err.message);
                }
            } else {
                console.log(`✅ Column ${column.name} added successfully.`);
            }
        });
    });
});

db.close((err) => {
    if (err) console.error(err.message);
    else console.log('✅ Migration complete and DB closed.');
});
