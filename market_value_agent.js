const fs = require('fs');
const path = require('path');

// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    LISTINGS_FILE: path.join(__dirname, 'listings.json'),
    MARKET_VALUES_FILE: path.join(__dirname, 'market_values.json'),
    MIN_PRICE: 500,           // Minimum price to consider (filter extremes)
    MAX_PRICE: 100000,        // Maximum price to consider (filter extremes)
    MIN_SAMPLES: 1,           // Minimum number of listings to calculate median (lowered for demo)
    MAX_SAMPLES: 100,         // Maximum number of listings per model/year
    MIN_YEAR: 2000,           // Minimum valid year
};

// ========================================
// CAR MAKE & MODEL EXTRACTION
// ========================================

// Common brand name variations
const BRAND_ALIASES = {
    'vw': 'Volkswagen',
    'škoda': 'Škoda',
    'skoda': 'Škoda',
    'mercedes-benz': 'Mercedes-Benz',
    'mercedes': 'Mercedes-Benz',
    'bmw': 'BMW',
    'audi': 'Audi',
    'ford': 'Ford',
    'opel': 'Opel',
    'peugeot': 'Peugeot',
    'renault': 'Renault',
    'citroen': 'Citroën',
    'citroën': 'Citroën',
    'toyota': 'Toyota',
    'honda': 'Honda',
    'mazda': 'Mazda',
    'nissan': 'Nissan',
    'hyundai': 'Hyundai',
    'kia': 'Kia',
    'seat': 'Seat',
    'tesla': 'Tesla',
    'volvo': 'Volvo',
    'fiat': 'Fiat',
    'alfa': 'Alfa Romeo',
    'jeep': 'Jeep',
    'land': 'Land Rover',
    'range': 'Land Rover',
};

// Known car models (for better extraction)
const KNOWN_MODELS = {
    'Volkswagen': ['Golf', 'Passat', 'Tiguan', 'Polo', 'T-Roc', 'T-Cross', 'Touareg', 'Arteon', 'Caddy', 'Transporter', 'ID.3', 'ID.4', 'ID.5'],
    'Škoda': ['Octavia', 'Fabia', 'Superb', 'Kodiaq', 'Karoq', 'Kamiq', 'Scala', 'Rapid', 'Enyaq'],
    'BMW': ['Series', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4', 'i3', 'i4', 'iX'],
    'Audi': ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q4', 'Q5', 'Q7', 'Q8', 'TT', 'e-tron'],
    'Mercedes-Benz': ['A-Class', 'B-Class', 'C-Class', 'E-Class', 'S-Class', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'CLA', 'CLS', 'EQC', 'EQA', 'EQB'],
    'Ford': ['Fiesta', 'Focus', 'Mondeo', 'Kuga', 'Puma', 'Explorer', 'Mustang', 'Ranger'],
    'Toyota': ['Yaris', 'Corolla', 'Camry', 'RAV4', 'C-HR', 'Highlander', 'Land Cruiser', 'Prius', 'Aygo'],
    'Hyundai': ['i10', 'i20', 'i30', 'i40', 'Tucson', 'Santa Fe', 'Kona', 'Ioniq', 'Nexo'],
    'Tesla': ['Model S', 'Model 3', 'Model X', 'Model Y'],
    'Seat': ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco', 'Alhambra'],
};

function extractMakeModel(title) {
    const titleLower = title.toLowerCase();

    // Try to find brand
    let make = null;
    let model = null;

    // Check for brand aliases
    for (const [alias, fullName] of Object.entries(BRAND_ALIASES)) {
        if (titleLower.startsWith(alias + ' ') || titleLower.includes(' ' + alias + ' ')) {
            make = fullName;
            break;
        }
    }

    // If no brand found, try first word
    if (!make) {
        const firstWord = title.split(' ')[0];
        if (firstWord && firstWord.length > 2) {
            make = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
            // Normalize to known brand if possible
            const normalized = BRAND_ALIASES[firstWord.toLowerCase()];
            if (normalized) make = normalized;
        }
    }

    // Try to find model
    if (make && KNOWN_MODELS[make]) {
        for (const knownModel of KNOWN_MODELS[make]) {
            const modelLower = knownModel.toLowerCase();
            if (titleLower.includes(modelLower)) {
                model = knownModel;
                break;
            }
        }
    }

    // Fallback: try to extract model from title (second word)
    if (!model) {
        const words = title.split(' ');
        if (words.length >= 2) {
            // Check for multi-word models
            if (words[1] && words[2]) {
                const twoWords = words[1] + ' ' + words[2];
                // Common patterns like "Model 3", "Model S", "C trieda"
                if (twoWords.match(/model [a-z0-9]/i) || twoWords.match(/[a-z] trieda/i) || twoWords.match(/[a-z]-class/i)) {
                    model = twoWords;
                }
            }
            // Single word model
            if (!model && words[1] && words[1].length > 1) {
                model = words[1];
            }
        }
    }

    return { make, model };
}

// ========================================
// STATISTICS FUNCTIONS
// ========================================

function calculateMedian(numbers) {
    if (!numbers || numbers.length === 0) return null;

    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    } else {
        return sorted[mid];
    }
}

function filterExtremes(listings, year) {
    return listings.filter(listing => {
        // Filter by price
        if (listing.price < CONFIG.MIN_PRICE || listing.price > CONFIG.MAX_PRICE) {
            return false;
        }

        // For newer cars (2015+), ignore very low prices (likely scams)
        if (year && year >= 2015 && listing.price < 2000) {
            return false;
        }

        return true;
    });
}

// ========================================
// MARKET VALUE CALCULATION
// ========================================

function analyzeMarketValues(listings) {
    console.log(`📊 Analyzing ${listings.length} listings...`);

    // Group listings by make, model, and year
    const groups = {};
    let skipped = 0;

    for (const listing of listings) {
        // Skip if no valid year
        if (!listing.year || listing.year < CONFIG.MIN_YEAR) {
            skipped++;
            continue;
        }

        // Extract make and model
        const { make, model } = extractMakeModel(listing.title);

        if (!make || !model) {
            skipped++;
            continue;
        }

        // Create group key
        const key = `${make}|${model}|${listing.year}`;

        if (!groups[key]) {
            groups[key] = {
                make,
                model,
                year: listing.year,
                listings: []
            };
        }

        groups[key].listings.push(listing);
    }

    console.log(`✅ Grouped into ${Object.keys(groups).length} categories (skipped ${skipped} invalid)`);

    // Calculate market values
    const marketValues = {};
    const modelStats = {}; // Track most common models

    for (const [key, group] of Object.entries(groups)) {
        const { make, model, year } = group;

        // Filter extremes
        const validListings = filterExtremes(group.listings, year);

        // Need at least MIN_SAMPLES for reliable median
        if (validListings.length < CONFIG.MIN_SAMPLES) {
            continue;
        }

        // Take max MAX_SAMPLES (most recent)
        const samplesToUse = validListings
            .sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt))
            .slice(0, CONFIG.MAX_SAMPLES);

        const prices = samplesToUse.map(l => l.price);
        const medianPrice = calculateMedian(prices);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);

        // Store in market values database
        if (!marketValues[make]) {
            marketValues[make] = {};
        }
        if (!marketValues[make][model]) {
            marketValues[make][model] = {};
        }

        marketValues[make][model][year] = {
            count: samplesToUse.length,
            medianPrice,
            minPrice,
            maxPrice,
            lastUpdated: new Date().toISOString()
        };

        // Track model stats
        const modelKey = `${make} ${model}`;
        if (!modelStats[modelKey]) {
            modelStats[modelKey] = 0;
        }
        modelStats[modelKey] += samplesToUse.length;

        console.log(`  💰 ${make} ${model} (${year}): €${medianPrice.toLocaleString()} (${samplesToUse.length} samples)`);
    }

    return { marketValues, modelStats };
}

// ========================================
// MAIN FUNCTION
// ========================================

function run() {
    console.log('🤖 Market Value Agent - STARTED\n');

    // Load listings
    if (!fs.existsSync(CONFIG.LISTINGS_FILE)) {
        console.error(`❌ Listings file not found: ${CONFIG.LISTINGS_FILE}`);
        console.log('💡 Run scraper_agent.js first to collect listings.');
        process.exit(1);
    }

    const listingsData = fs.readFileSync(CONFIG.LISTINGS_FILE, 'utf-8');
    const listings = JSON.parse(listingsData);

    console.log(`📁 Loaded ${listings.length} listings from ${CONFIG.LISTINGS_FILE}\n`);

    // Analyze market values
    const { marketValues, modelStats } = analyzeMarketValues(listings);

    // Save market values database
    fs.writeFileSync(CONFIG.MARKET_VALUES_FILE, JSON.stringify(marketValues, null, 2));
    console.log(`\n💾 Market values saved to ${CONFIG.MARKET_VALUES_FILE}`);

    // Display most common models
    const topModels = Object.entries(modelStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    console.log('\n🏆 Top 10 Most Common Models:');
    topModels.forEach(([model, count], index) => {
        console.log(`  ${index + 1}. ${model} - ${count} listings`);
    });

    // Summary statistics
    const totalModels = Object.keys(modelStats).length;
    const totalEntries = Object.values(marketValues).reduce((sum, make) => {
        return sum + Object.values(make).reduce((s, model) => {
            return s + Object.keys(model).length;
        }, 0);
    }, 0);

    console.log(`\n📈 Summary:`);
    console.log(`  - Total unique models: ${totalModels}`);
    console.log(`  - Total price entries: ${totalEntries}`);
    console.log(`  - Price range filter: €${CONFIG.MIN_PRICE} - €${CONFIG.MAX_PRICE.toLocaleString()}`);
    console.log(`  - Min samples for median: ${CONFIG.MIN_SAMPLES}`);

    console.log('\n✅ Market Value Agent - COMPLETED');
}

// Run the agent
run();
