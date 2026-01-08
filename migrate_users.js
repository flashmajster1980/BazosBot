const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'bot_database.sqlite'));

db.serialize(() => {
    console.log('--- Migrating Users Table ---');

    // Add google_id column
    db.run("ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE", (err) => {
        if (err && err.message.includes('duplicate column name')) {
            console.log('google_id column already exists.');
        } else if (err) {
            console.error('Error adding google_id:', err.message);
        } else {
            console.log('✅ Added google_id column.');
        }
    });

    // Add avatar_url column
    db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT", (err) => {
        if (err && err.message.includes('duplicate column name')) {
            console.log('avatar_url column already exists.');
        } else if (err) {
            console.error('Error adding avatar_url:', err.message);
        } else {
            console.log('✅ Added avatar_url column.');
        }
    });

    // Ensure subscription_status defaults to 'free' (renaming logic concept)
    // SQLite doesn't support changing default easily, but we handle it in code.
    console.log('--- Migration Finished ---');
});

db.close();
