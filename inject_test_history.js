const { dbAsync } = require('./database');

async function injectSpecificHistory() {
    const ids = ['187189500', '186948416', '186948690', '187066901', 'eu_AmP6NzwG41u'];
    console.log('💉 Injecting dummy history for specific listings:', ids);

    for (const id of ids) {
        const l = await dbAsync.get('SELECT price FROM listings WHERE id = ?', [id]);
        if (!l) {
            console.log(`⚠️ Listing ${id} not found in DB.`);
            continue;
        }

        const oldPrice1 = Math.round(l.price * 1.15);
        const oldPrice2 = Math.round(l.price * 1.10);

        const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];

        // Ensure we don't have too many duplicates if run multiple times
        await dbAsync.run('DELETE FROM price_history WHERE listing_id = ? AND price != ?', [id, l.price]);

        await dbAsync.run('INSERT INTO price_history (listing_id, price, checked_at) VALUES (?, ?, ?)', [id, oldPrice1, fourDaysAgo]);
        await dbAsync.run('INSERT INTO price_history (listing_id, price, checked_at) VALUES (?, ?, ?)', [id, oldPrice2, twoDaysAgo]);

        console.log(`✅ Fixed history for ${id}`);
    }

    console.log('🚀 Finalizing...');
    process.exit(0);
}

injectSpecificHistory();
