const { dbAsync } = require('./database');

async function checkDriveStats() {
    console.log('📊 Checking Drive (Pohon) Data Stats...');
    try {
        const total = await dbAsync.get('SELECT COUNT(*) as count FROM listings');
        const missing = await dbAsync.get('SELECT COUNT(*) as count FROM listings WHERE drive IS NULL OR drive = ""');
        const byPortal = await dbAsync.all('SELECT portal, COUNT(*) as missingCount FROM listings WHERE drive IS NULL OR drive = "" GROUP BY portal');

        console.log(`\nTotal Listings: ${total.count}`);
        console.log(`Missing Drive: ${missing.count} (${Math.round(missing.count / total.count * 100)}%)`);

        console.log('\nMissing by Portal:');
        byPortal.forEach(r => console.log(`- ${r.portal}: ${r.missingCount}`));

        // Show a few examples
        const examples = await dbAsync.all('SELECT id, title, portal, url FROM listings WHERE drive IS NULL OR drive = "" LIMIT 5');
        console.log('\nExamples of missing drive:');
        examples.forEach(e => console.log(`[${e.portal}] ${e.title} (${e.url})`));

    } catch (err) {
        console.error('Error:', err.message);
    }
}

checkDriveStats();
