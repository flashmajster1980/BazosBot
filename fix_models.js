const { dbAsync } = require('./database');
const { extractMakeModel } = require('./utils');

async function fixModels() {
    console.log('🔄 Starting Model Migration...');
    const listings = await dbAsync.all("SELECT id, title, make, model FROM listings"); // Fetch minimal data

    let updated = 0;

    for (const listing of listings) {
        if (!listing.title) continue;

        const extracted = extractMakeModel(listing.title);

        // Check if model changed (or make)
        if (extracted.model && extracted.model !== listing.model) {
            console.log(`📝 [${listing.id}] ${listing.model} -> ${extracted.model} (${listing.title})`);

            // Update DB
            await dbAsync.run(
                "UPDATE listings SET make = ?, model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [extracted.make || listing.make, extracted.model, listing.id]
            );
            updated++;
        }
    }

    console.log(`✅ Migration Complete. Updated ${updated} listings.`);
}

fixModels().catch(console.error);
