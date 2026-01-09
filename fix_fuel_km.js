const db = require('./database');

async function fixMissingData() {
    try {
        console.log('🔧 Starting Missing Data Fix (Fuel/KM) - CORRECTION RUN...');

        // Scan ALL listings to correct data corruption and mislabeled ones
        const listings = await db.dbAsync.all("SELECT id, title, make, model, fuel FROM listings");
        console.log(`Scanning ${listings.length} listings for fuel correction...`);

        let fixedCount = 0;

        for (const l of listings) {
            const text = (l.title + ' ' + (l.model || '')).toLowerCase();
            let newFuel = null;
            let currentFuel = l.fuel;

            // STRICT PRIORITY LOGIC
            // 1. Diesel (Highest Priority)
            if (text.match(/tdi|\bd\b|crd|cdti|hdi|tdci|dci|jtd|cdi|sdv6|sdv8|ddis|did/)) {
                newFuel = 'Diesel';
            }
            else if (text.match(/\d{3}d\b/)) { // BMW 320d
                newFuel = 'Diesel';
            }

            // 2. Electric (High Priority)
            else if (text.match(/elektro|electric|\bev\b|\bid\.3|\bid\.4|\bid\.5|\btesla\b|enyaq|taycan|eqc|eqe|eqs/)) {
                // Exclude 'Levice' via \bev\b? Already done.
                newFuel = 'Elektro';
            }

            // 3. Hybrid
            else if (text.match(/hybrid|phev|mhev/)) {
                newFuel = 'Hybrid';
            }

            // 4. Petrol (Lowest Priority - only if no others match)
            else if (text.match(/tsi|tfsi|\bi\b|gti|mpower|amg|vtec/)) {
                // V6/V8/RS removed because they can be Diesel too
                newFuel = 'Benzín';
            }
            else if (text.match(/\d{3}i\b/)) { // BMW 330i
                newFuel = 'Benzín';
            }

            // CORRECTION LOGIC
            if (newFuel && (currentFuel !== newFuel)) {

                // If it was wrongly set to Petrol (because of V6/RS) but is Diesel -> Fix it back.
                if (currentFuel === 'Benzín' && newFuel === 'Diesel') {
                    console.log(`✅ REVERTING False Petrol: ${l.id}: ${l.title} (Benzín -> Diesel)`);
                    await db.dbAsync.run("UPDATE listings SET fuel = ? WHERE id = ?", [newFuel, l.id]);
                    fixedCount++;
                }

                // If it was wrongly set to Elektro (Levice) but is Diesel -> Fix it.
                else if (currentFuel === 'Elektro' && newFuel === 'Diesel') {
                    console.log(`✅ Fixing False EV: ${l.id}: ${l.title} (Elektro -> Diesel)`);
                    await db.dbAsync.run("UPDATE listings SET fuel = ? WHERE id = ?", [newFuel, l.id]);
                    fixedCount++;
                }

                // If it was wrongly set to Elektro but is Petrol -> Fix it.
                else if (currentFuel === 'Elektro' && newFuel === 'Benzín') {
                    console.log(`✅ Fixing False EV: ${l.id}: ${l.title} (Elektro -> Benzín)`);
                    await db.dbAsync.run("UPDATE listings SET fuel = ? WHERE id = ?", [newFuel, l.id]);
                    fixedCount++;
                }

                // If Null -> Fill it.
                else if (!currentFuel) {
                    await db.dbAsync.run("UPDATE listings SET fuel = ? WHERE id = ?", [newFuel, l.id]);
                    fixedCount++;
                }
            }
        }

        console.log(`✨ Corrected Fuel for ${fixedCount} listings.`);

    } catch (err) {
        console.error('Fix Error:', err);
    }
}

fixMissingData();
