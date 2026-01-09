const { dbAsync } = require('./database');

async function runComparison() {
    console.log('⚖️ VALUATION COMPARISON ANALYSIS');
    console.log('================================');

    const listings = await dbAsync.all("SELECT id, title, price, corrected_median, ai_verdict, make, model, year FROM listings WHERE ai_verdict IS NOT NULL LIMIT 50");

    console.log(`Analyzing ${listings.length} listings...\n`);

    let totalDiff = 0;
    let count = 0;
    let marketHigher = 0;
    let aiHigher = 0;

    console.log('| ID | Car | Listing Price | Market Median (Stats) | AI Expert (Algo) | Diff (Market - AI) |');
    console.log('|---|---|---|---|---|---|');

    for (const l of listings) {
        if (!l.corrected_median || !l.ai_verdict) continue;

        // Parse AI Price from text "**Odhadovaná Férová Cena:** 18 000 € - 20 000 €"
        const aiMatch = l.ai_verdict.match(/Odhadovaná Férová Cena:\*\* ([\d\s]+)/);
        if (!aiMatch) continue;

        const aiPrice = parseFloat(aiMatch[1].replace(/\s/g, ''));
        const marketPrice = l.corrected_median;

        const diff = marketPrice - aiPrice;
        const diffPercent = ((marketPrice - aiPrice) / aiPrice) * 100;

        totalDiff += Math.abs(diffPercent);
        count++;

        if (diff > 0) marketHigher++;
        else aiHigher++;

        // Show only significant diffs or sample
        if (Math.abs(diffPercent) > 15) {
            console.log(`| ${l.id} | ${l.make} ${l.model} (${l.year}) | ${l.price} € | ${marketPrice} € | ${aiPrice} € | ${Math.round(diff)} € (${Math.round(diffPercent)}%) |`);
        }
    }

    console.log('\n--------------------------------');
    console.log('SUMMARY FINDINGS:');
    console.log(`Avg Discrepancy: ${Math.round(totalDiff / count)}%`);
    console.log(`Market Median is Higher: ${marketHigher} times`);
    console.log(`AI Expert is Higher: ${aiHigher} times`);
    console.log('--------------------------------');
}

runComparison();
