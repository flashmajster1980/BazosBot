const { dbAsync } = require('./database');

async function cleanDuplicates() {
    console.log('🧹 Cleaning duplicates by URL...');

    // Find URLs that appear more than once
    const duplicates = await dbAsync.all(`
        SELECT url, COUNT(*) as count 
        FROM listings 
        GROUP BY url 
        HAVING count > 1
    `);

    console.log(`Found ${duplicates.length} duplicated URLs.`);

    for (const d of duplicates) {
        // Get all IDs for this URL
        const rows = await dbAsync.all('SELECT id FROM listings WHERE url = ?', [d.url]);

        // Keep the one that DOESN'T look random if possible (or just the first one)
        // Check if any id matches the regex properly (contains the real ID)
        // If all are random-ish, just keep the first one.

        // Actually, since I fixed the regex now, the NEXT scrape will generate the CORRECT ID.
        // It might be better to delete ALL of them and let the next scrape re-populate?
        // OR keep one.

        // Let's delete all but one.
        const idsToDelete = rows.slice(1).map(r => r.id);

        console.log(`Keeping ${rows[0].id}, deleting ${idsToDelete.join(', ')}`);

        for (const id of idsToDelete) {
            await dbAsync.run('DELETE FROM listings WHERE id = ?', [id]);
        }
    }

    console.log('Done.');
}

if (require.main === module) {
    cleanDuplicates();
}

module.exports = { cleanDuplicates };
