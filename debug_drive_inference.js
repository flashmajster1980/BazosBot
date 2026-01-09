const { dbAsync } = require('./database');

async function debugDrive() {
    console.log('🔍 Debugging Drive Inference...');

    // Get the specific listing
    const listing = await dbAsync.get('SELECT * FROM listings WHERE title LIKE "%Hyundai Santa Fe%" AND title LIKE "%4x4%" LIMIT 1');

    if (!listing) {
        console.log('Listing not found');
        return;
    }

    console.log('--- Original Listing ---');
    console.log(`ID: ${listing.id}`);
    console.log(`Title: ${listing.title}`);
    console.log(`Desc: ${listing.description ? listing.description.substring(0, 50) : 'NULL'}...`);
    console.log(`Drive (DB): "${listing.drive}" (Type: ${typeof listing.drive})`);

    // Simulate Scoring Logic
    const lowerText = (listing.title + ' ' + (listing.description || '')).toLowerCase();

    let drive = listing.drive;
    console.log(`Initial drive variable: "${drive}"`);

    // Check if empty/null check works
    if (!drive || drive.trim() === '') {
        console.log('Drive is considered empty. Entering inference...');
        if (lowerText.match(/4x4|4wd|awd|quattro|4motion|x-drive|xdrive|allgrip/)) {
            drive = '4x4';
            console.log('Matched 4x4 regex!');
        }
        else if (lowerText.match(/zadný|zadny|rwd/)) drive = 'Zadný';
        else drive = 'Predný';
    } else {
        console.log('Drive is NOT empty. Skipping inference.');
    }

    console.log(`Final Drive: "${drive}"`);
}

debugDrive();
