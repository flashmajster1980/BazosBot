const fs = require('fs');
const path = require('path');

// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    LISTINGS_FILE: path.join(__dirname, 'listings.json'),
    MARKET_VALUES_FILE: path.join(__dirname, 'market_values.json'),
    SCORED_LISTINGS_FILE: path.join(__dirname, 'scored_listings.json'),
    GOLDEN_DEAL_THRESHOLD: 12,  // Slightly lowered because scoring is stricter now
    GOOD_DEAL_THRESHOLD: 6,
    KM_ADJUSTMENT_RATE: 0.05,  // 0.05€ per km
    REFERENCE_KM_YEARLY: 20000,
};

// ========================================
// PROBLEMATIC KEYWORDS FILTER
// ========================================
const BAD_KEYWORDS = [
    'havarované', 'havarovaný', 'havarovaná', 'havarovan',
    'poškodené', 'poškodený', 'poškodená', 'poskoden',
    'motor ko', 'motor defekt', 'nefunkčný motor', 'nefunkcny motor',
    'nepojazdné', 'nepojazdny', 'nepojazdná',
    'na náhradné diely', 'na nahradne diely', 'na diely',
    'bez stk', 'bez ek', 'bez emisnej kontroly',
    'odpísané', 'odpisane', 'odpisany',
    'nehavarované', // negation but often suspicious
    'vážne poškodené', 'vazne poskodene',
    'totálna škoda', 'totalna skoda',
    'po havárii', 'po havarii',
    'rozbité', 'rozbity', 'rozbitá',
    'odstúpim leasing', 'odstupim leasing', 'leasing',
    'rozpredám', 'rozpredam', 'na súčiastky',
    'chyba motora', 'puknutý blok', 'zadretý',

    // English
    'crashed', 'accident', 'total loss',
    'salvage', 'parts only', 'not running',
    'engine failure', 'broken engine',
    'frame damage', 'flood damage',

    // Czech
    'havarované', 'po nehode', 'nehavarované',
    'motor nefunguje',
];

// ========================================
// HELPER FUNCTIONS
// ========================================

// Feature extraction matching market_value_agent.js
function extractEngine(listing) {
    let engine = 'Unknown';
    if (listing.fuel && listing.power) {
        const powerValue = parseInt(listing.power);
        if (powerValue) {
            let powerBucket = 'Base';
            if (powerValue > 200) powerBucket = 'Extreme';
            else if (powerValue > 150) powerBucket = 'High';
            else if (powerValue > 110) powerBucket = 'Mid-High';
            else if (powerValue > 80) powerBucket = 'Mid';
            engine = `${listing.fuel} ${powerBucket} (${powerValue}kW)`;
        } else { engine = listing.fuel; }
    } else if (listing.fuel) { engine = listing.fuel; }
    return engine;
}

const EQUIPMENT_KEYWORDS = {
    'LED/Xenon': ['led', 'xenon', 'bixenon', 'matrix', 'laser'],
    'Navigácia': ['navigácia', 'navigacia', 'navi', 'gps'],
    'Koža': ['koža', 'koza', 'leather'],
    'Panoráma': ['panoráma', 'panorama', 'strešné okno', 'siber'],
    '4x4': ['4x4', '4wd', 'awd', 'quattro', '4motion', 'xdrive'],
    'Ťažné': ['ťažné', 'tazne', 'hák'],
    'Webasto': ['webasto', 'nezávislé kúrenie', 'nezavisle kurenie'],
    'ACC/Tempomat': ['acc', 'adaptívny tempomat', 'adaptivny tempomat', 'distronic'],
    'Kamera': ['kamera', 'camera', '360'],
};

function extractEquipmentScore(listing) {
    const text = (listing.title + ' ' + (listing.description || '')).toLowerCase();
    let score = 0;
    const foundFeatures = [];
    for (const [feature, keywords] of Object.entries(EQUIPMENT_KEYWORDS)) {
        if (keywords.some(k => text.includes(k))) {
            score++;
            foundFeatures.push(feature);
        }
    }
    let level = 'Basic';
    if (score >= 5) level = 'Full';
    else if (score >= 2) level = 'Medium';
    return { score, level, foundFeatures };
}

function extractMakeModel(title) {
    const BRAND_ALIASES = {
        'vw': 'Volkswagen', 'škoda': 'Škoda', 'skoda': 'Škoda',
        'mercedes-benz': 'Mercedes-Benz', 'mercedes': 'Mercedes-Benz',
        'bmw': 'BMW', 'audi': 'Audi', 'seat': 'Seat', 'tesla': 'Tesla',
        'hyundai': 'Hyundai', 'ford': 'Ford', 'opel': 'Opel',
        'peugeot': 'Peugeot', 'renault': 'Renault', 'toyota': 'Toyota',
    };

    const titleLower = title.toLowerCase();
    let make = null;
    let model = null;

    for (const [alias, fullName] of Object.entries(BRAND_ALIASES)) {
        if (titleLower.startsWith(alias + ' ') || titleLower.includes(' ' + alias + ' ')) {
            make = fullName;
            break;
        }
    }

    if (!make) {
        const firstWord = title.split(' ')[0];
        if (firstWord && firstWord.length > 2) {
            make = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
            const normalized = BRAND_ALIASES[firstWord.toLowerCase()];
            if (normalized) make = normalized;
        }
    }

    if (make) {
        const words = title.split(' ');
        if (words.length >= 2) {
            if (words[1] && words[2]) {
                const twoWords = words[1] + ' ' + words[2];
                if (twoWords.match(/model [a-z0-9]/i) || twoWords.match(/[a-z] trieda/i)) {
                    model = twoWords;
                }
            }
            if (!model && words[1] && words[1].length > 1) {
                model = words[1];
            }
        }
    }

    return { make, model };
}

function checkBadKeywords(title) {
    const titleLower = title.toLowerCase();
    const foundKeywords = [];

    for (const keyword of BAD_KEYWORDS) {
        if (titleLower.includes(keyword.toLowerCase())) {
            foundKeywords.push(keyword);
        }
    }

    return {
        isFiltered: foundKeywords.length > 0,
        keywords: foundKeywords
    };
}

function calculateDealType(discount) {
    if (discount >= CONFIG.GOLDEN_DEAL_THRESHOLD) {
        return { type: 'GOLDEN DEAL', emoji: '🌟', score: 95 };
    } else if (discount >= CONFIG.GOOD_DEAL_THRESHOLD) {
        return { type: 'GOOD DEAL', emoji: '✅', score: 75 };
    } else if (discount >= 0) {
        return { type: 'FAIR PRICE', emoji: '⚖️', score: 50 };
    } else {
        return { type: 'OVERPRICED', emoji: '❌', score: 20 };
    }
}

// ========================================
// DEDUPLICATION LOGIC
// ========================================

function generateFingerprint(listing) {
    // 1. If VIN is available, it's the gold standard
    if (listing.vin && listing.vin.length === 17) {
        return `VIN:${listing.vin.toUpperCase()}`;
    }

    // 2. Fuzzy match fingerprint
    // Identify car precisely enough but allow for small portal differences
    const { make, model } = extractMakeModel(listing.title);
    if (!make || !model || !listing.year) return null;

    // Price tolerance: round to nearest 100
    const roundedPrice = Math.round(listing.price / 100) * 100;

    // KM tolerance: round to nearest 1000
    const roundedKm = listing.km ? Math.round(listing.km / 1000) * 1000 : 'N/A';

    // Location: first word (usually city or district)
    const shortLoc = listing.location ? listing.location.split(',')[0].split(' ')[0].trim() : 'N/A';

    return `FUZZY:${make}|${model}|${listing.year}|${roundedPrice}|${roundedKm}|${shortLoc}`;
}

function deduplicateListings(listings) {
    console.log(`🔍 Checking for cross-portal duplicates...`);
    const finalMap = new Map();
    let duplicatesFound = 0;

    for (const listing of listings) {
        const fingerprint = generateFingerprint(listing);
        if (!fingerprint) {
            // Keep listings that can't be fingerprinted (shouldn't happen with valid car data)
            finalMap.set(`RAW:${listing.id}`, listing);
            continue;
        }

        if (finalMap.has(fingerprint)) {
            const existing = finalMap.get(fingerprint);

            // Keep the one with better price or newer portal if prices are same
            if (listing.price < existing.price) {
                // Listing is cheaper, replace existing but keep record of other portal
                listing.otherPortals = existing.otherPortals || [];
                listing.otherPortals.push({ portal: existing.portal, url: existing.url, price: existing.price });
                finalMap.set(fingerprint, listing);
            } else {
                // Existing is better or same, just record this one
                existing.otherPortals = existing.otherPortals || [];
                existing.otherPortals.push({ portal: listing.portal, url: listing.url, price: listing.price });
            }
            duplicatesFound++;
        } else {
            finalMap.set(fingerprint, { ...listing, otherPortals: [] });
        }
    }

    console.log(`✅ Deduplication complete: ${duplicatesFound} duplicates filtered out.\n`);
    return Array.from(finalMap.values());
}

// ========================================
// SCORING LOGIC
// ========================================

function scoreListings(listings, marketValues) {
    console.log(`📊 Scoring ${listings.length} listings with advanced criteria...\n`);

    const scoredListings = [];
    let goldenDeals = 0;
    let goodDeals = 0;
    let filtered = 0;
    const currentYear = new Date().getFullYear();

    for (const listing of listings) {
        const { make, model } = extractMakeModel(listing.title);
        if (!make || !model || !listing.year) continue;

        const engine = extractEngine(listing);
        const equip = extractEquipmentScore(listing);
        const keywordCheck = checkBadKeywords(listing.title);

        // 1. Find Best Match Median within Mileage Segments
        let medianPrice = null;
        let matchAccuracy = 'broad';
        let refKm = 0;

        // Listing's mileage segment mapping
        let kmSegmentKey = 'mid';
        let kmSegmentLabel = 'Mid-km (100k-200k)';
        if (listing.km < 100000) {
            kmSegmentKey = 'low';
            kmSegmentLabel = 'Low-km (0-100k)';
        } else if (listing.km > 200000) {
            kmSegmentKey = 'high';
            kmSegmentLabel = 'High-km (nad 200k)';
        }

        // Check specific match including kmSegmentKey
        const specificMatch = marketValues.specific?.[make]?.[model]?.[listing.year]?.[engine]?.[equip.level]?.[kmSegmentKey];
        if (specificMatch) {
            medianPrice = specificMatch.medianPrice;
            matchAccuracy = 'specific';
            refKm = specificMatch.avgKm || (kmSegmentKey === 'low' ? 60000 : kmSegmentKey === 'mid' ? 150000 : 250000);
        } else {
            // Fallback to broad match
            const broadMatch = marketValues.broad?.[make]?.[model]?.[listing.year]?.[kmSegmentKey];
            if (broadMatch) {
                medianPrice = broadMatch.medianPrice;
                refKm = broadMatch.avgKm || (kmSegmentKey === 'low' ? 60000 : kmSegmentKey === 'mid' ? 150000 : 250000);
            }
        }

        // Final fallback to any kmSegment in broad
        if (!medianPrice) {
            const anySegment = marketValues.broad?.[make]?.[model]?.[listing.year];
            if (anySegment) {
                const firstSeg = Object.values(anySegment)[0];
                medianPrice = firstSeg.medianPrice;
                refKm = firstSeg.avgKm || 150000;
            }
        }

        if (!medianPrice) continue;

        let correctedMedian = medianPrice;

        // 2. KM PENALTY: -2.5% for every 10,000 km above segment average
        const kmAboveRef = (listing.km || refKm) - refKm;
        if (kmAboveRef > 0) {
            const penaltySteps = kmAboveRef / 10000;
            const penaltyPercent = penaltySteps * 0.025; // 2.5% per 10k km
            correctedMedian *= (1 - penaltyPercent);
        } else if (kmAboveRef < 0) {
            // Bonus for lower km: +1.5% per 10k km
            const bonusSteps = Math.abs(kmAboveRef) / 10000;
            const bonusPercent = bonusSteps * 0.015;
            correctedMedian *= (1 + bonusPercent);
        }

        // 3. PSYCHOLOGICAL THRESHOLD: -10% for cars over 200,000 km
        if (listing.km > 200000) {
            correctedMedian *= 0.90;
        }

        // 4. Apply Equipment Bonus (only if using broad median)
        if (matchAccuracy === 'broad') {
            if (equip.level === 'Full') correctedMedian *= 1.12;
            else if (equip.level === 'Medium') correctedMedian *= 1.05;
        }

        // 5. YEAR SANITY CHECK
        const nextYearData = marketValues.broad?.[make]?.[model]?.[listing.year + 1]?.[kmSegmentKey];
        if (nextYearData && correctedMedian > nextYearData.medianPrice * 1.1) {
            correctedMedian = nextYearData.medianPrice * 1.05;
        }

        // ENSURE POSITIVE: Median should never be less than 40% of original
        correctedMedian = Math.max(medianPrice * 0.4, correctedMedian);

        // 6. Calculate Final Score
        const discount = ((correctedMedian - listing.price) / correctedMedian) * 100;
        const dealInfo = calculateDealType(discount);

        let finalScore = dealInfo.score;
        if (keywordCheck.isFiltered) {
            finalScore = Math.max(0, finalScore - 50);
            filtered++;
        }

        // Explanation string for UI
        const dealReason = `Cena o ${Math.round(discount)} % nižšia ako medián v kategórii ${kmSegmentLabel}`;

        scoredListings.push({
            ...listing,
            make, model, engine,
            equipLevel: equip.level,
            features: equip.foundFeatures,
            kmSegment: kmSegmentLabel,
            matchAccuracy,
            originalMedian: medianPrice,
            correctedMedian: Math.round(correctedMedian),
            kmReference: Math.round(refKm),
            discount: Math.round(discount * 10) / 10,
            dealReason,
            dealType: dealInfo.type,
            score: finalScore,
            isFiltered: keywordCheck.isFiltered,
            scoredAt: new Date().toISOString()
        });

        if (dealInfo.type === 'GOLDEN DEAL' && !keywordCheck.isFiltered) goldenDeals++;
        if (dealInfo.type === 'GOOD DEAL' && !keywordCheck.isFiltered) goodDeals++;
    }

    return { scoredListings, goldenDeals, goodDeals, filtered };
}

// ========================================
// MAIN FUNCTION
// ========================================

function run() {
    console.log('🤖 Scoring Agent - STARTED\n');

    // Load listings
    if (!fs.existsSync(CONFIG.LISTINGS_FILE)) {
        console.error(`❌ Listings file not found: ${CONFIG.LISTINGS_FILE}`);
        process.exit(1);
    }

    // Load market values
    if (!fs.existsSync(CONFIG.MARKET_VALUES_FILE)) {
        console.error(`❌ Market values file not found: ${CONFIG.MARKET_VALUES_FILE}`);
        console.log('💡 Run market_value_agent.js first to generate market values.');
        process.exit(1);
    }

    const listingsData = fs.readFileSync(CONFIG.LISTINGS_FILE, 'utf-8');
    let listings = JSON.parse(listingsData);

    const marketValuesData = fs.readFileSync(CONFIG.MARKET_VALUES_FILE, 'utf-8');
    const marketValues = JSON.parse(marketValuesData);

    console.log(`📁 Loaded ${listings.length} raw listings`);
    console.log(`📁 Loaded market values database\n`);

    // Cross-portal Deduplication
    listings = deduplicateListings(listings);

    // Score listings
    const { scoredListings, goldenDeals, goodDeals, filtered } = scoreListings(listings, marketValues);

    // Sort by score (highest first)
    scoredListings.sort((a, b) => b.score - a.score);

    // Save scored listings
    fs.writeFileSync(CONFIG.SCORED_LISTINGS_FILE, JSON.stringify(scoredListings, null, 2));

    // Also save as JS variable for local dashboard (to bypass CORS)
    const jsContent = `window.scoredListingsData = ${JSON.stringify(scoredListings, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, 'scored_listings_data.js'), jsContent);

    console.log(`💾 Scored listings saved to ${CONFIG.SCORED_LISTINGS_FILE}`);
    console.log(`💾 JS Data saved to scored_listings_data.js (for local dashboard)\n`);

    // Display top deals
    const topDeals = scoredListings
        .filter(l => !l.isFiltered && l.dealType === 'GOLDEN DEAL')
        .slice(0, 5);

    if (topDeals.length > 0) {
        console.log('🏆 TOP GOLDEN DEALS (not filtered):\n');
        topDeals.forEach((deal, index) => {
            console.log(`${index + 1}. ${deal.make} ${deal.model} (${deal.year}) | ${deal.engine} | ${deal.equipLevel}`);
            console.log(`   Price: €${deal.price.toLocaleString()} | Corrected Median: €${deal.correctedMedian.toLocaleString()} | Discount: ${deal.discount}%`);
            console.log(`   Score: ${deal.score} | ${deal.url}`);
            console.log();
        });
    } else {
        console.log('ℹ️  No GOLDEN DEALs found in current listings.\n');
    }

    // Summary
    console.log(`\n📈 Summary:`);
    console.log(`  - Total scored: ${scoredListings.length}`);
    console.log(`  - 🌟 GOLDEN DEALs: ${goldenDeals} (${CONFIG.GOLDEN_DEAL_THRESHOLD}%+ discount)`);
    console.log(`  - ✅ GOOD DEALs: ${goodDeals} (${CONFIG.GOOD_DEAL_THRESHOLD}%+ discount)`);
    console.log(`  - ⚠️  Filtered (bad keywords): ${filtered}`);

    // Auto-trigger communication agent if GOLDEN DEALs found
    if (goldenDeals > 0) {
        console.log(`\n📱 Triggering Communication Agent...`);
        const { exec } = require('child_process');
        exec('node communication_agent.js', (error, stdout, stderr) => {
            if (error) {
                console.error(`   ❌ Error: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`   ⚠️  ${stderr}`);
            }
            console.log(stdout);
        });
    }

    console.log('\n✅ Scoring Agent - COMPLETED');
}

// Run the agent
run();
