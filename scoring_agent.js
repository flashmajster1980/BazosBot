const fs = require('fs');
const path = require('path');

// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    LISTINGS_FILE: path.join(__dirname, 'listings.json'),
    MARKET_VALUES_FILE: path.join(__dirname, 'market_values.json'),
    SCORED_LISTINGS_FILE: path.join(__dirname, 'scored_listings.json'),
    GOLDEN_DEAL_THRESHOLD: 15,  // 15% discount or more
    GOOD_DEAL_THRESHOLD: 8,      // 8% discount or more
};

// ========================================
// PROBLEMATIC KEYWORDS FILTER
// ========================================
const BAD_KEYWORDS = [
    // Slovak
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

function extractMakeModel(title) {
    // Same logic as market_value_agent.js
    const BRAND_ALIASES = {
        'vw': 'Volkswagen',
        'škoda': 'Škoda',
        'skoda': 'Škoda',
        'mercedes-benz': 'Mercedes-Benz',
        'mercedes': 'Mercedes-Benz',
        'bmw': 'BMW',
        'audi': 'Audi',
        'seat': 'Seat',
        'tesla': 'Tesla',
        'hyundai': 'Hyundai',
        'ford': 'Ford',
        'opel': 'Opel',
        'peugeot': 'Peugeot',
        'renault': 'Renault',
        'toyota': 'Toyota',
    };

    const titleLower = title.toLowerCase();
    let make = null;
    let model = null;

    // Check for brand aliases
    for (const [alias, fullName] of Object.entries(BRAND_ALIASES)) {
        if (titleLower.startsWith(alias + ' ') || titleLower.includes(' ' + alias + ' ')) {
            make = fullName;
            break;
        }
    }

    // Fallback: first word
    if (!make) {
        const firstWord = title.split(' ')[0];
        if (firstWord && firstWord.length > 2) {
            make = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
            const normalized = BRAND_ALIASES[firstWord.toLowerCase()];
            if (normalized) make = normalized;
        }
    }

    // Extract model (second word or two words for "Model 3" etc)
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
// SCORING LOGIC
// ========================================

function scoreListings(listings, marketValues) {
    console.log(`📊 Scoring ${listings.length} listings...\n`);

    const scoredListings = [];
    let goldenDeals = 0;
    let goodDeals = 0;
    let filtered = 0;

    for (const listing of listings) {
        // Extract make and model
        const { make, model } = extractMakeModel(listing.title);

        if (!make || !model || !listing.year) {
            console.log(`⏭️  SKIP: ${listing.title} (cannot extract make/model/year)`);
            continue;
        }

        // Check for problematic keywords
        const keywordCheck = checkBadKeywords(listing.title);

        // Lookup median price
        const medianPrice = marketValues[make]?.[model]?.[listing.year]?.medianPrice;

        if (!medianPrice) {
            console.log(`⏭️  SKIP: ${make} ${model} ${listing.year} (no market data)`);
            continue;
        }

        // Calculate discount percentage
        const discount = ((medianPrice - listing.price) / medianPrice) * 100;
        const dealInfo = calculateDealType(discount);

        // Adjust score if filtered
        let finalScore = dealInfo.score;
        if (keywordCheck.isFiltered) {
            finalScore = Math.max(0, finalScore - 50); // Major penalty
            filtered++;
        }

        const scoredListing = {
            id: listing.id,
            title: listing.title,
            price: listing.price,
            year: listing.year,
            km: listing.km,
            make,
            model,
            medianPrice,
            discount: Math.round(discount * 10) / 10, // Round to 1 decimal
            dealType: dealInfo.type,
            score: finalScore,
            isFiltered: keywordCheck.isFiltered,
            filteredKeywords: keywordCheck.keywords,
            url: listing.url,
            scoredAt: new Date().toISOString()
        };

        scoredListings.push(scoredListing);

        // Count deals
        if (dealInfo.type === 'GOLDEN DEAL') goldenDeals++;
        if (dealInfo.type === 'GOOD DEAL') goodDeals++;

        // Log
        const filterTag = keywordCheck.isFiltered ? '⚠️ FILTERED' : '';
        console.log(`${dealInfo.emoji} ${dealInfo.type} ${filterTag}`);
        console.log(`   ${listing.title}`);
        console.log(`   Price: €${listing.price.toLocaleString()} | Median: €${medianPrice.toLocaleString()} | Discount: ${discount.toFixed(1)}%`);
        if (keywordCheck.isFiltered) {
            console.log(`   ⚠️  Keywords: ${keywordCheck.keywords.join(', ')}`);
        }
        console.log();
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
    const listings = JSON.parse(listingsData);

    const marketValuesData = fs.readFileSync(CONFIG.MARKET_VALUES_FILE, 'utf-8');
    const marketValues = JSON.parse(marketValuesData);

    console.log(`📁 Loaded ${listings.length} listings`);
    console.log(`📁 Loaded market values database\n`);

    // Score listings
    const { scoredListings, goldenDeals, goodDeals, filtered } = scoreListings(listings, marketValues);

    // Sort by score (highest first)
    scoredListings.sort((a, b) => b.score - a.score);

    // Save scored listings
    fs.writeFileSync(CONFIG.SCORED_LISTINGS_FILE, JSON.stringify(scoredListings, null, 2));
    console.log(`💾 Scored listings saved to ${CONFIG.SCORED_LISTINGS_FILE}\n`);

    // Display top deals
    const topDeals = scoredListings
        .filter(l => !l.isFiltered && l.dealType === 'GOLDEN DEAL')
        .slice(0, 5);

    if (topDeals.length > 0) {
        console.log('🏆 TOP GOLDEN DEALS (not filtered):\n');
        topDeals.forEach((deal, index) => {
            console.log(`${index + 1}. ${deal.make} ${deal.model} (${deal.year})`);
            console.log(`   Price: €${deal.price.toLocaleString()} | Median: €${deal.medianPrice.toLocaleString()} | Discount: ${deal.discount}%`);
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
