const fs = require('fs');
const path = require('path');
const { dbAsync } = require('./database');

const BASE_PRICES = JSON.parse(fs.readFileSync(path.join(__dirname, 'original_prices.json'), 'utf-8'));

// 1. KROK: Odhad pôvodnej ceny (P_start)
function estimateOriginalPrice(listing) {
    let basePrice = 25000; // Default
    const make = listing.make || '';
    const model = listing.model || '';

    // Find in DB
    for (const [dbMake, models] of Object.entries(BASE_PRICES)) {
        if (make.toLowerCase().includes(dbMake.toLowerCase())) {
            for (const [dbModel, price] of Object.entries(models)) {
                if (model.toLowerCase().includes(dbModel.toLowerCase()) || listing.title.toLowerCase().includes(dbModel.toLowerCase())) {
                    basePrice = price;
                    break;
                }
            }
        }
    }

    // Adjust for Engine / Performance
    // Base prices are usually for entry-level. 
    // Powerful engines add cost.
    const kw = listing.power; // e.g. "110 kW"
    if (kw) {
        const val = parseInt(kw);
        if (val > 140) basePrice *= 1.25; // High power
        else if (val > 110) basePrice *= 1.10; // Mid power
    }

    // Technology inflation (newer cars are more expensive base)
    // Very rough heuristic: +3% per year of production year > 2015
    const year = listing.year;
    if (year > 2015) {
        const inflation = (year - 2015) * 0.03;
        basePrice *= (1 + inflation);
    }

    return Math.round(basePrice);
}

// 2. KROK: Základná amortizácia
function calculateDepreciation(originalPrice, year, segment) {
    const age = new Date().getFullYear() - year;
    if (age < 0) return originalPrice; // Future? :D

    // Standard Curve: Value = P * (retention_rate ^ age)
    // Premium cars drop faster initially

    let retentionRate = 0.85; // Standard (15% drop per year)

    if (segment === 'Premium') retentionRate = 0.82; // Sharper drop
    if (age === 0) return originalPrice * 0.85; // Instant drop of new card

    let depreciatedPrice = originalPrice * Math.pow(retentionRate, age);

    // Floor value (cars rarely go to 0 active market)
    if (depreciatedPrice < 1000) depreciatedPrice = 1000;

    return Math.round(depreciatedPrice);
}

// 3. KROK: Korekcia podľa nájazdu
function applyMileageCorrection(price, listing) {
    const age = new Date().getFullYear() - listing.year;
    const fuel = listing.fuel || 'Diesel';
    const km = listing.km || 0;

    let annualNorm = 15000;
    if (fuel.includes('Diesel')) annualNorm = 25000;
    if (fuel.includes('Elektro')) annualNorm = 12000;

    const expectedKm = Math.max(10000, age * annualNorm);
    const diff = km - expectedKm;

    // Penalty/Bonus per KM
    // E.g. 0.04 EUR per km deviation for median car
    let rate = 0.04;
    if (price > 30000) rate = 0.08; // More expensive cars care more about mileage

    const correction = -(diff * rate);

    // Psychological Limits
    let psychPenalty = 0;
    if (km > 200000) psychPenalty -= 1000;
    if (km > 300000) psychPenalty -= 2000;

    return Math.round(price + correction + psychPenalty);
}

// 4. KROK: Trhové faktory a výbava
function applyFeatures(price, listing) {
    let finalPrice = price;
    const text = (listing.title + ' ' + (listing.description || '')).toLowerCase();

    const features = [];

    if (text.includes('4x4') || text.includes('4wd') || text.includes('quattro') || text.includes('4motion')) {
        finalPrice += 1200;
        features.push('4x4 pohon (+1200€)');
    }

    if (listing.transmission === 'Automat' || text.includes('dsg') || text.includes('automat')) {
        finalPrice += 1200;
        features.push('Automat (+1200€)');
    }

    if (text.includes('panorama') || text.includes('strešné okno')) {
        finalPrice += 500;
        features.push('Panoráma (+500€)');
    }

    if (text.includes('koža') || text.includes('alcantara') || text.includes('leather')) {
        finalPrice += 600;
        features.push('Kožený interiér (+600€)');
    }

    if (text.includes('full led') || text.includes('matrix') || text.includes('xenon')) {
        finalPrice += 700;
        features.push('Lepšie svetlá (+700€)');
    }

    if (text.includes('virtual cockpit') || text.includes('digitálny štít')) {
        finalPrice += 400;
        features.push('Virtual Cockpit (+400€)');
    }

    if (text.includes('dph') || text.includes('odpočet')) {
        // Business benefit - usually priced in but good to note
        features.push('Možný odpočet DPH (Výhoda)');
    }

    return { price: Math.round(finalPrice), features };
}

async function runEvaluator() {
    console.log('🧐 Expert Valuator - STARTED');
    const listings = await dbAsync.all("SELECT * FROM listings WHERE is_sold = 0");
    console.log(`Analyzing ${listings.length} listings...`);

    let updated = 0;

    for (const l of listings) {
        if (!l.year || !l.price) continue;

        // 1. Initial
        const pStart = estimateOriginalPrice(l);

        // 2. Depreciated
        let fairPrice = calculateDepreciation(pStart, l.year, 'Standard');

        // 3. Mileage
        fairPrice = applyMileageCorrection(fairPrice, l);

        // 4. Features
        let { price: finalFairPrice, features } = applyFeatures(fairPrice, l);

        // Sanity Check
        // Auto shouldn't be bellow scrap value or unrealistically high vs listing
        // If our algo says 5000 but listing is 25000, we prefer the "Market Median" if available
        // But the user wants OUR expert algo. We just floor it.
        if (finalFairPrice < 500) finalFairPrice = 500;

        // VERDICT GENERATION
        const diffPercent = ((l.price - finalFairPrice) / finalFairPrice) * 100;
        let verdictLabel = 'Férová cena';
        let sentiment = 'neutral';

        if (diffPercent < -15) { verdictLabel = 'SUPER CENA'; sentiment = 'positive'; }
        else if (diffPercent < -5) { verdictLabel = 'Dobrá cena'; sentiment = 'positive'; }
        else if (diffPercent > 20) { verdictLabel = 'Predražené'; sentiment = 'negative'; }
        else if (diffPercent > 10) { verdictLabel = 'Vyššia cena'; sentiment = 'negative'; }

        const pros = features;
        const cons = [];
        if (l.km > 200000) cons.push('Vysoký nájazd (>200k)');
        if (!l.location) cons.push('Chýba lokácia');
        if (l.description && l.description.length < 50) cons.push('Stručný popis');

        const expertAnalysis = `
### 🧐 Expertný Odhad
**Odhadovaná Férová Cena:** ${finalFairPrice.toLocaleString()} € - ${(finalFairPrice * 1.1).toLocaleString()} €
**Pôvodná cena (odhad):** ${pStart.toLocaleString()} €
**Verdikt:** ${verdictLabel} (${diffPercent > 0 ? '+' : ''}${Math.round(diffPercent)}% vs odhad)

**Plusy:**
${pros.length > 0 ? pros.map(p => `- ${p}`).join('\n') : '- Štandardná výbava'}

**Poznámky:**
${cons.length > 0 ? cons.map(c => `- ${c}`).join('\n') : '- Bez zjavných rizík z popisu'}
        `.trim();

        // Update DB
        // We will store this text in ai_verdict temporarily to show it deals
        // But better: store fair price in `corrected_median` (User asked for expert valuation to be THE validation)
        // Actually, let's keep corrected_median as statistical, and put this text in ai_verdict.

        await dbAsync.run(
            'UPDATE listings SET ai_verdict = ?, risk_score = ? WHERE id = ?',
            [expertAnalysis, l.risk_score, l.id] // We don't change risk score yet
        );

        updated++;
        if (updated % 50 === 0) process.stdout.write('.');
    }

    console.log(`\n✅ Evaluated ${updated} listings.`);
}

runEvaluator();
