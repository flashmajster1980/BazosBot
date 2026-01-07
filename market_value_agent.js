const fs = require('fs');
const path = require('path');

// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    LISTINGS_FILE: path.join(__dirname, 'listings.json'),
    MARKET_VALUES_FILE: path.join(__dirname, 'market_values.json'),
    MIN_PRICE: 500,           // Minimum price to consider (filter extremes)
    MAX_PRICE: 200000,        // Maximum price to consider (filter extremes)
    MIN_SAMPLES: 1,           // Minimum number of listings to calculate median
    MAX_SAMPLES: 200,         // Maximum number of listings per model
    MIN_YEAR: 2000,           // Minimum valid year
    HISTORY_FILE: path.join(__dirname, 'market_history.json'),
    KM_ADJUSTMENT_RATE: 0.05, // 0.05€ per km adjustment
    REFERENCE_KM_YEARLY: 20000, // Average 20k km per year
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

// ========================================
// FEATURE EXTRACTION
// ========================================

function extractEngine(listing) {
    let engine = 'Unknown';
    if (listing.fuel && listing.power) {
        // Normalize power (e.g., 110 kW)
        const powerValue = parseInt(listing.power);
        if (powerValue) {
            // Group power into buckets to avoid too many small groups
            // e.g., 0-80, 81-110, 111-150, 151-200, 201+
            let powerBucket = 'Base';
            if (powerValue > 200) powerBucket = 'Extreme';
            else if (powerValue > 150) powerBucket = 'High';
            else if (powerValue > 110) powerBucket = 'Mid-High';
            else if (powerValue > 80) powerBucket = 'Mid';

            engine = `${listing.fuel} ${powerBucket} (${powerValue}kW)`;
        } else {
            engine = listing.fuel;
        }
    } else if (listing.fuel) {
        engine = listing.fuel;
    }
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

// Data Cleaning Filters
const BAD_KEYWORDS = [
    'odstúpim leasing', 'odstupim leasing', 'leasing',
    'havarované', 'havarovane', 'havarovaný', 'havarovany',
    'na náhradné diely', 'na nahradne diely', 'na diely', 'na súčiastky', 'na suciastky',
    'rozpredám', 'rozpredam',
    'chyba motora', 'zadretý', 'zadrety',
    'bez tp', 'bez špz', 'bez spz',
    'na prihlásenie', 'na prihlasenie', 'dovezené bez prihlásenia'
];

function isProblematic(listing) {
    const text = (listing.title + ' ' + (listing.description || '')).toLowerCase();
    return BAD_KEYWORDS.some(k => text.includes(k.toLowerCase()));
}

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

    // Categorize equipment level
    let level = 'Basic';
    if (score >= 5) level = 'Full';
    else if (score >= 2) level = 'Medium';

    return { score, level, foundFeatures };
}

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
            // Match whole word for model to avoid A3 matching A30
            const regex = new RegExp(`\\b${modelLower}\\b`, 'i');
            if (titleLower.match(regex)) {
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
                if (twoWords.match(/model [a-z0-9]/i) || twoWords.match(/[a-z] trieda/i) || twoWords.match(/[a-z]-class/i)) {
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
// HISTORY FUNCTIONS
// ========================================

function updateHistory(marketValues) {
    let history = {};
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
        try {
            history = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf-8'));
        } catch (e) {
            console.warn('⚠️ Could not parse history file, starting fresh.');
        }
    }

    const timestamp = new Date().toISOString();

    for (const [make, models] of Object.entries(marketValues.broad || {})) {
        if (!history[make]) history[make] = {};
        for (const [model, years] of Object.entries(models)) {
            if (!history[make][model]) history[make][model] = {};
            for (const [year, stats] of Object.entries(years)) {
                if (!history[make][model][year]) history[make][model][year] = [];

                // Add new entry
                history[make][model][year].push({
                    date: timestamp,
                    median: stats.medianPrice,
                    count: stats.count
                });

                // Keep only last 30 entries
                if (history[make][model][year].length > 30) {
                    history[make][model][year] = history[make][model][year].slice(-30);
                }
            }
        }
    }

    fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history, null, 2));
    console.log(`📈 History updated in ${CONFIG.HISTORY_FILE}`);
}

// ========================================
// MARKET VALUE CALCULATION
// ========================================

function analyzeMarketValues(listings) {
    console.log(`📊 Analyzing ${listings.length} listings...`);

    // Group listings by multiple criteria including mileage segments
    const groups = {}; // Key: make|model|year|engine|equipLevel|kmSegment
    const broadGroups = {}; // Key: make|model|year|kmSegment
    let skipped = 0;

    const currentYear = new Date().getFullYear();

    for (const listing of listings) {
        // Data cleaning: Skip problematic listings (leasing, crashed, parts, etc.)
        if (isProblematic(listing)) {
            skipped++;
            continue;
        }

        // Skip if no valid year
        if (!listing.year || listing.year < CONFIG.MIN_YEAR) {
            skipped++;
            continue;
        }

        // Extract features
        const { make, model } = extractMakeModel(listing.title);
        if (!make || !model) {
            skipped++;
            continue;
        }

        const engine = extractEngine(listing);
        const equip = extractEquipmentScore(listing);

        // Mileage segmentation
        let kmSegment = 'mid'; // 100k-200k (default)
        if (listing.km < 100000) kmSegment = 'low';
        else if (listing.km > 200000) kmSegment = 'high';

        // Group keys
        const broadKey = `${make}|${model}|${listing.year}|${kmSegment}`;
        const specificKey = `${make}|${model}|${listing.year}|${engine}|${equip.level}|${kmSegment}`;

        // Initialize groups
        if (!broadGroups[broadKey]) {
            broadGroups[broadKey] = { make, model, year: listing.year, kmSegment, listings: [] };
        }
        if (!groups[specificKey]) {
            groups[specificKey] = { make, model, year: listing.year, engine, equipLevel: equip.level, kmSegment, listings: [] };
        }

        broadGroups[broadKey].listings.push(listing);
        groups[specificKey].listings.push(listing);
    }

    console.log(`✅ Grouped into ${Object.keys(groups).length} specific and ${Object.keys(broadGroups).length} broad categories`);

    // Calculate market values
    const marketValues = {
        specific: {},
        broad: {}
    };
    const modelStats = {};

    // Process Broad Groups
    for (const [key, group] of Object.entries(broadGroups)) {
        const { make, model, year, kmSegment } = group;
        const validListings = filterExtremes(group.listings, year);
        if (validListings.length < CONFIG.MIN_SAMPLES) continue;

        const prices = validListings.map(l => l.price);
        const medianPrice = calculateMedian(prices);

        if (!marketValues.broad[make]) marketValues.broad[make] = {};
        if (!marketValues.broad[make][model]) marketValues.broad[make][model] = {};
        if (!marketValues.broad[make][model][year]) marketValues.broad[make][model][year] = {};

        marketValues.broad[make][model][year][kmSegment] = {
            count: validListings.length,
            medianPrice,
            minPrice: Math.min(...prices),
            maxPrice: Math.max(...prices),
            avgKm: Math.round(validListings.reduce((sum, l) => sum + (l.km || 0), 0) / validListings.length),
            lastUpdated: new Date().toISOString()
        };

        const modelKey = `${make} ${model}`;
        modelStats[modelKey] = (modelStats[modelKey] || 0) + validListings.length;
    }

    // Process Specific Groups
    for (const [key, group] of Object.entries(groups)) {
        const { make, model, year, engine, equipLevel, kmSegment } = group;
        const validListings = filterExtremes(group.listings, year);
        if (validListings.length < CONFIG.MIN_SAMPLES) continue;

        const prices = validListings.map(l => l.price);
        const medianPrice = calculateMedian(prices);

        if (!marketValues.specific[make]) marketValues.specific[make] = {};
        if (!marketValues.specific[make][model]) marketValues.specific[make][model] = {};
        if (!marketValues.specific[make][model][year]) marketValues.specific[make][model][year] = {};
        if (!marketValues.specific[make][model][year][engine]) marketValues.specific[make][model][year][engine] = {};
        if (!marketValues.specific[make][model][year][engine][equipLevel]) marketValues.specific[make][model][year][engine][equipLevel] = {};

        marketValues.specific[make][model][year][engine][equipLevel][kmSegment] = {
            count: validListings.length,
            medianPrice,
            minPrice: Math.min(...prices),
            maxPrice: Math.max(...prices)
        };
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

    // Update history
    updateHistory(marketValues);

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
    const totalBroadEntries = Object.values(marketValues.broad).reduce((sum, make) => {
        return sum + Object.values(make).reduce((s, model) => {
            return s + Object.keys(model).length;
        }, 0);
    }, 0);

    console.log(`\n📈 Summary:`);
    console.log(`  - Total unique models: ${totalModels}`);
    console.log(`  - Total broad price entries: ${totalBroadEntries}`);
    console.log(`  - Price range filter: €${CONFIG.MIN_PRICE} - €${CONFIG.MAX_PRICE.toLocaleString()}`);
    console.log(`  - Min samples for median: ${CONFIG.MIN_SAMPLES}`);

    console.log('\n✅ Market Value Agent - COMPLETED');
}

// Run the agent
run();
