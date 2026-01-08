const { dbAsync, identifySellerType } = require('./database');

async function runFix() {
    console.log('🔧 Starting bulk fix for seller types...');

    try {
        // Find all listings where seller_type is not standard
        const listings = await dbAsync.all("SELECT id, seller_name FROM listings WHERE seller_type NOT IN ('Dealer', 'Private') OR seller_type IS NULL");
        console.log(`📊 Found ${listings.length} listings with non-standard seller type.`);

        let count = 0;
        for (const l of listings) {
            const sellerType = await identifySellerType(l.seller_name, dbAsync);
            await dbAsync.run('UPDATE listings SET seller_type = ? WHERE id = ?', [sellerType, l.id]);

            count++;
            if (count % 100 === 0) {
                console.log(`⏳ Updated ${count}/${listings.length} listings...`);
            }
        }

        console.log(`✅ Success! Updated ${count} listings.`);
    } catch (err) {
        console.error('❌ Error during fix:', err.message);
    } finally {
        process.exit(0);
    }
}

runFix();
