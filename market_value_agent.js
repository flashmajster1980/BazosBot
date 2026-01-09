const fs = require('fs');
const path = require('path');
const { extractMakeModel } = require('./utils');

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

// function extractMakeModel(title) { ... } removed (using utils.js)


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
    const { saveMarketStat } = require('./database');
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

                // Add to JSON history
                history[make][model][year].push({
                    date: timestamp,
                    median: stats.medianPrice,
                    count: stats.count
                });

                // Keep only last 30 entries
                if (history[make][model][year].length > 30) {
                    history[make][model][year] = history[make][model][year].slice(-30);
                }

                // ALSO SAVE TO SQL DATABASE
                saveMarketStat(`${make} ${model}`, parseInt(year), stats.medianPrice);
            }
        }
    }

    fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history, null, 2));
    console.log(`📈 History updated in ${CONFIG.HISTORY_FILE} and Database.`);
}

// ========================================
// MARKET VALUE CALCULATION
// ========================================

function calculateNewCarBenchmarks(listings) {
    const prices = {};
    const currentYear = new Date().getFullYear(); // 2026

    for (const l of listings) {
        if (!l.price || !l.year) continue;

        // Strategy 1: Real Demo Cars (2024+, < 5000 km)
        const isDemo = l.year >= currentYear - 2 && l.km < 5000;

        // Strategy 2: "Almost New" (Top of the market for recent years)
        // Just collect high prices for recent years to find the ceiling
        const isRecent = l.year >= currentYear - 3;

        if (isDemo || isRecent) {
            // Exclude high performance / special editions from "base" new price calculation
            const titleLower = l.title.toLowerCase();
            if (titleLower.includes('rs') || titleLower.includes('vrs') || titleLower.includes('scout') ||
                titleLower.includes('amg') || titleLower.includes('m-packet') || titleLower.includes('m packet')) {
                continue;
            }

            // Also exclude high power cars (likely RS/GTI/M) to keep "standard" baseline
            if (l.power) {
                const power = parseInt(l.power);
                if (power > 145) continue; // Skip anything above ~197 HP for standard baseline
            }

            const { make, model } = extractMakeModel(l.title);
            if (make && model) {
                if (!prices[make]) prices[make] = {};
                if (!prices[make][model]) prices[make][model] = [];
                // Store object to distinguish type later if needed, for now just price
                prices[make][model].push(l.price);
            }
        }
    }

    const benchmarks = {};
    for (const make in prices) {
        benchmarks[make] = {};
        for (const model in prices[make]) {
            const modelPrices = prices[make][model].sort((a, b) => a - b); // Ascending sort

            // Heuristic for "New Price":
            // Take the 60th percentile. This filters out L&K, RS, and fully loaded models
            // aiming for a "well-equipped standard" baseline.
            const index60th = Math.floor(modelPrices.length * 0.6);
            const estimatedNewPrice = modelPrices[Math.min(index60th, modelPrices.length - 1)];

            benchmarks[make][model] = estimatedNewPrice;
        }
    }
    return benchmarks;
}

function analyzeMarketValues(listings) {
    console.log(`📊 Analyzing ${listings.length} listings...`);

    const newCarBenchmarks = calculateNewCarBenchmarks(listings);
    console.log(`🆕 Calculated benchmarks for ${Object.keys(newCarBenchmarks).length} makes.`);
    // Debug specific model
    if (newCarBenchmarks['Škoda'] && newCarBenchmarks['Škoda']['Octavia']) {
        console.log(`🔍 DEBUG: Default New Price for Škoda Octavia: €${newCarBenchmarks['Škoda']['Octavia']}`);
    }

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

        // Skip if no valid year or KM
        if (!listing.year || listing.year < CONFIG.MIN_YEAR || !listing.km || listing.km === 0) {
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

        // Mileage Tiers
        let kmSegment = 'mid';
        if (listing.km < 100000) kmSegment = 'low';
        else if (listing.km < 200000) kmSegment = 'mid';
        else if (listing.km < 250000) kmSegment = 'high1';
        else if (listing.km < 300000) kmSegment = 'high2';
        else if (listing.km < 400000) kmSegment = 'level300';
        else if (listing.km < 500000) kmSegment = 'level400';
        else kmSegment = 'zombie';

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
        let validListings = filterExtremes(group.listings, year);

        // STRICT SEGMENTATION: older than 1 year but < 5000 km -> Demo cars, ignore for "Used" median
        // Years 2020-2023 (approx. 3-6 years old in 2026 context)
        if (year >= 2020 && year <= 2023) {
            const beforeCount = validListings.length;
            validListings = validListings.filter(l => l.km >= 5000);
            if (validListings.length < beforeCount) {
                // console.log(`   Filtered ${beforeCount - validListings.length} demo cars from ${make} ${model} ${year}`);
            }
        }

        if (validListings.length < CONFIG.MIN_SAMPLES) continue;

        const prices = validListings.map(l => l.price);
        let medianPrice = calculateMedian(prices);

        // DEPRECIATION CURVE CHECK
        // If car is > 3 years old, value shouldn't be > 70% of new price
        const currentYear = new Date().getFullYear();
        const age = currentYear - year;
        if (age >= 3 && newCarBenchmarks[make] && newCarBenchmarks[make][model]) {
            const newPrice = newCarBenchmarks[make][model];
            const maxAllowed = newPrice * 0.70;
            if (medianPrice > maxAllowed) {
                // console.log(`⚠️  Depreciation Cap applied for ${make} ${model} (${year}): €${medianPrice} -> €${Math.round(maxAllowed)} (New: €${newPrice})`);
                medianPrice = Math.round(maxAllowed);
            }
        }

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
        let medianPrice = calculateMedian(prices);

        // DEPRECIATION CURVE CHECK (Specific Group)
        const currentYear = new Date().getFullYear();
        const age = currentYear - year;
        if (age >= 3 && newCarBenchmarks[make] && newCarBenchmarks[make][model]) {
            const newPrice = newCarBenchmarks[make][model];
            const maxAllowed = newPrice * 0.70;
            if (medianPrice > maxAllowed) {
                medianPrice = Math.round(maxAllowed);
            }
        }

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
