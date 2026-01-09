const fs = require('fs');
const path = require('path');
const NormalizationService = require('./services/normalizationService');
const calculateMarketRef = require('./market_value_agent');
const { extractMakeModel } = require('./utils');

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
    'bez tp', 'bez špz', 'bez spz',
    'na prihlásenie', 'na prihlasenie', 'dovezené bez prihlásenia',

    // English
    'crashed', 'accident', 'total loss',
    'salvage', 'parts only', 'not running',
    'engine failure', 'broken engine',
    'frame damage', 'flood damage',

    // Czech
    'havarované', 'po nehode', 'nehavarované',
    'motor nefunguje',
    'búrané', 'burane', 'burana', 'burany', // Added based on user report
];

// ========================================
// HELPER FUNCTIONS
// ========================================

// Feature extraction matching market_value_agent.js
const BASE_PRICES = JSON.parse(fs.readFileSync(path.join(__dirname, 'original_prices.json'), 'utf-8'));

// ========================================
// EXPERT VALUATION LOGIC
// ========================================
function estimateOriginalPrice(listing) {
    let basePrice = 25000;
    const make = listing.make || '';
    const model = listing.model || '';

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
    const kw = listing.power;
    if (kw) {
        const val = parseInt(kw);
        if (val > 140) basePrice *= 1.25;
        else if (val > 110) basePrice *= 1.10;
    }
    const year = listing.year;
    if (year > 2015) {
        const inflation = (year - 2015) * 0.03;
        basePrice *= (1 + inflation);
    }
    return Math.round(basePrice);
}

function calculateDepreciation(originalPrice, year, segment) {
    const age = new Date().getFullYear() - year;
    if (age < 0) return originalPrice;

    // RECALIBRATION 2.0 (Market Reality)
    // Old logic was too strict (0.85). Real market holds value better (0.89 - 0.91).
    let retentionRate = 0.89;

    if (segment === 'Premium') retentionRate = 0.86; // Still drops faster but less strict
    if (age === 0) return originalPrice * 0.90; // Only 10% drop instant

    let depreciatedPrice = originalPrice * Math.pow(retentionRate, age);

    // MARKET INFLATION FACTOR
    // Used cars older than 4 years are inflated by ~20-30% on current market
    if (age > 4) {
        depreciatedPrice *= 1.25;
    }



    // BRAND PREMIUM (Slovak market loves VW/Skoda/Audi)
    // Instead of complex logic, we just maintain a slightly higher floor
    if (depreciatedPrice < 1500) depreciatedPrice = 1500;

    return Math.round(depreciatedPrice);
}

function applyMileageCorrection(price, listing) {
    const age = new Date().getFullYear() - listing.year;
    const fuel = listing.fuel || 'Diesel';
    const km = listing.km || 0;
    let annualNorm = 15000;
    if (fuel.includes('Diesel')) annualNorm = 25000;
    if (fuel.includes('Elektro')) annualNorm = 12000;
    const expectedKm = Math.max(10000, age * annualNorm);
    const diff = km - expectedKm;
    let rate = 0.04;
    if (price > 30000) rate = 0.08;
    const correction = -(diff * rate);
    let psychPenalty = 0;
    if (km > 200000) psychPenalty -= 1000;
    if (km > 300000) psychPenalty -= 2000;
    return Math.round(price + correction + psychPenalty);
}

function applyFeatures(price, listing) {
    let finalPrice = price;
    const text = (listing.title + ' ' + (listing.description || '')).toLowerCase();
    const features = [];
    const make = (listing.make || '').toLowerCase();
    const model = (listing.model || '').toLowerCase();

    // STANDARD EQUIPMENT CHECK
    // For these models, 4x4 and Automatics are expected/standard
    // We shouldn't add a bonus for them.
    const isPremiumSUV = (
        (make === 'bmw' && model.includes('x5')) ||
        (make === 'bmw' && model.includes('x6')) ||
        (make === 'bmw' && model.includes('x7')) ||
        (make === 'audi' && model.includes('q7')) ||
        (make === 'audi' && model.includes('q8')) ||
        (make === 'mercedes-benz' && model.includes('gle')) ||
        (make === 'mercedes-benz' && model.includes('gls')) ||
        (make === 'volkswagen' && model.includes('touareg')) ||
        (make === 'porsche' && model.includes('cayenne'))
    );

    const is4x4 = text.includes('4x4') || text.includes('4wd') || text.includes('quattro') || text.includes('4motion') || (listing.drive && listing.drive === '4x4');
    if (is4x4) {
        if (!isPremiumSUV) {
            finalPrice += 1200; features.push('4x4 pohon (+1200€)');
        }
    }

    const isAuto = listing.transmission === 'Automat' || text.includes('dsg') || text.includes('automat');
    if (isAuto) {
        if (!isPremiumSUV) {
            finalPrice += 1200; features.push('Automat (+1200€)');
        }
    }

    if (text.includes('panorama') || text.includes('strešné okno')) {
        finalPrice += 500; features.push('Panoráma (+500€)');
    }
    if (text.includes('koža') || text.includes('alcantara') || text.includes('leather')) {
        finalPrice += 600; features.push('Kožený interiér (+600€)');
    }
    if (text.includes('full led') || text.includes('matrix') || text.includes('xenon')) {
        finalPrice += 700; features.push('Lepšie svetlá (+700€)');
    }
    if (text.includes('virtual cockpit') || text.includes('digitálny štít')) {
        finalPrice += 400; features.push('Virtual Cockpit (+400€)');
    }
    if (text.includes('dph') || text.includes('odpočet')) {
        features.push('Možný odpočet DPH (Výhoda)');
    }
    return { price: Math.round(finalPrice), features };
}

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

// function extractMakeModel(title) { ... } removed (using utils.js)

function checkBadKeywords(listing) {
    const text = (listing.title + ' ' + (listing.description || '')).toLowerCase();
    const foundKeywords = [];

    for (const keyword of BAD_KEYWORDS) {
        if (text.includes(keyword.toLowerCase())) {
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
            finalMap.set(fingerprint, { ...listing, fingerprint, otherPortals: [] });
        }
    }

    console.log(`✅ Deduplication complete: ${duplicatesFound} duplicates filtered out.\n`);
    return Array.from(finalMap.values());
}

// ========================================
// SCORING LOGIC
function calculateLiquidity(listing, discount, age) {
    let score = 20; // Default LOW
    const make = (listing.make || '').toLowerCase();

    // 1. Base Score by Brand
    const topBrands = ['škoda', 'skoda', 'volkswagen', 'vw', 'audi', 'toyota', 'hyundai', 'kia'];
    const midBrands = ['ford', 'opel', 'peugeot', 'renault', 'bmw', 'mercedes-benz', 'mercedes'];

    if (topBrands.includes(make)) score = 80;
    else if (midBrands.includes(make)) score = 50;

    // 2. Modifiers
    // Discount: +2 pts per 1% discount
    if (discount > 0) score += (discount * 2);

    // Kilometers
    if (listing.km && listing.km < 150000) score += 15;
    else if (listing.km > 300000) score -= 30;

    // Age
    if (age <= 7) score += 10;
    else if (age > 15) score -= 20;

    // Clamp 0-100
    score = Math.max(0, Math.min(100, score));

    // 3. Classification
    let label = '🐌 Ležiak';
    let color = '#ff4d4d'; // Red (Nízka)
    let category = 'Nízka';

    if (score >= 80) {
        label = '🔥 Horúci tovar';
        color = '#00ff88'; // Green (Vysoká)
        category = 'Vysoká';
    } else if (score >= 50) {
        label = '✅ Štandard';
        color = '#fdda25'; // Yellow (Dobrá)
        category = 'Dobrá';
    }

    return {
        score: Math.round(score),
        label,
        color,
        category,
        estimate: score >= 80 ? 'do 3 dní' : (score >= 50 ? 'do 2 týždňov' : '1 mesiac+')
    };
}

function analyzeSeller(listing, allListings) {
    const sellerId = listing.phone || listing.author || 'Unknown';
    const listingsCount = allListings.filter(l => (l.phone && l.phone === listing.phone) || (l.author && l.author === listing.author)).length;

    const text = (listing.title + ' ' + (listing.description || '')).toLowerCase();
    const dealerKeywords = ['možný odpočet dph', 'mozny odpocet dph', 'možný leasing', 'mozny leasing', 'možný úver', 'mozny uver', 'záruka na vozidlo', 'zaruka na vozidlo', 'volať v pracovných hodinách', 'volat v pracovnych hodinach'];
    const hasDealerKeywords = dealerKeywords.some(k => text.includes(k));

    let type = 'Súkromná osoba';
    let icon = '👤';
    let color = '#00ff88'; // Green

    if (listingsCount > 10 || hasDealerKeywords) {
        type = 'Profesionálny autobazár';
        icon = '🏭';
        color = '#3498db'; // blue
    } else if (listingsCount >= 3) {
        type = 'Malý kšeftár';
        icon = '🏭';
        color = '#bdc3c7'; // gray
    }

    return { type, icon, color, listingsCount, isPrivate: type === 'Súkromná osoba' };
}

function calculateNegotiationScore(listing, seller, discount, isGoldenDeal) {
    const isCashOnly = (listing.description || '').toLowerCase().includes('iba hotovosť') || (listing.description || '').toLowerCase().includes('len hotovost');

    let score = 0;
    if (seller.isPrivate) score += 40;
    if (isGoldenDeal) score += 40;
    if (isCashOnly) score += 20;

    return Math.min(100, score);
}

function calculateRiskScore(listing, medianPrice) {
    let riskPoints = 0;

    // 1. Missing VIN (+30 points)
    if (!listing.vin || listing.vin.length < 17) {
        riskPoints += 30;
    }

    // 2. Price anomaly (+40 points if price > 35% below median)
    if (medianPrice && listing.price < medianPrice * 0.65) {
        riskPoints += 40;
    }

    // 3. Suspicious mileage (+25 points)
    // If year < 2018, km < 100k, and no mention of service book
    const hasServiceBook = (listing.description || '').toLowerCase().match(/servisn(á|a) kni(ž|z)ka|serviska|uplna servisna/);
    if (listing.year < 2018 && listing.km < 100000 && !hasServiceBook) {
        riskPoints += 25;
    }

    // 4. Anonymný predajca / Suspicious seller (+20 points)
    // If seller_type is Bazár but pretending to be private, or no name
    const isDealerPretending = (listing.seller_type === 'Bazár/Kšeftár' && !listing.seller_name);
    if (isDealerPretending || !listing.seller_name) {
        riskPoints += 20;
    }

    // Clamp score 0-100
    riskPoints = Math.min(100, riskPoints);

    let level = 'Nízke';
    let color = '#00ff88'; // Green
    if (riskPoints > 60) {
        level = 'VYSOKÉ';
        color = '#ff4d4d'; // Red
    } else if (riskPoints > 30) {
        level = 'Stredné';
        color = '#fdda25'; // Orange
    }

    return { score: riskPoints, level, color };
}

// ========================================
// SCORING LOGIC
// ========================================

async function scoreListings(listings, marketValues, dbAsync) {
    console.log(`📊 Scoring ${listings.length} listings with advanced criteria...\n`);

    const scoredListings = [];
    let goldenDeals = 0;
    let goodDeals = 0;
    let filtered = 0;
    const { dbType } = require('./database');
    const marketHistoryData = await dbAsync.all(`
        SELECT model, year, median_price, date 
        FROM market_stats 
        WHERE date >= ${dbType === 'postgres' ? "CURRENT_DATE - INTERVAL '30 days'" : "date('now', '-30 days')"}
    `);

    // Group history for quick lookup
    const historyMap = {};
    marketHistoryData.forEach(row => {
        const key = `${row.model}|${row.year}`;
        if (!historyMap[key]) historyMap[key] = [];
        historyMap[key].push(row.median_price);
    });

    const currentYear = new Date().getFullYear();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];

    const recentHistory = await dbAsync.all(`
        SELECT model, year, median_price 
        FROM market_stats 
        WHERE date >= ?
    `, [weekAgoStr]);

    const weekHistoryMap = {};
    recentHistory.forEach(row => {
        const key = `${row.model}|${row.year}`;
        if (!weekHistoryMap[key]) weekHistoryMap[key] = [];
        weekHistoryMap[key].push(row.median_price);
    });

    for (const listing of listings) {
        const { make, model } = extractMakeModel(listing.title);
        if (!make || !model || !listing.year) continue;

        // --- TREND CALCULATION ---
        const historyKey = `${make} ${model}|${listing.year}`;
        const last30Days = historyMap[historyKey] || [];
        const avg30DayPrice = last30Days.length > 0
            ? last30Days.reduce((a, b) => a + b, 0) / last30Days.length
            : null;

        let priceTrend = null;
        let freshDiscount = false;

        if (avg30DayPrice) {
            const diff = ((listing.price - avg30DayPrice) / avg30DayPrice) * 100;
            priceTrend = {
                diff: Math.round(diff * 10) / 10,
                label: diff <= -5 ? '📉 Cena klesá' : (diff >= 5 ? '📈 Cena stúpa' : '⚖️ Stabilná'),
                color: diff <= -5 ? '#00ff88' : (diff >= 5 ? '#ff4d4d' : '#94a3b8'),
                icon: diff <= -5 ? '↓' : (diff >= 5 ? '↑' : '→'),
                isDropping: diff <= -5
            };
        }

        // --- PRICE HISTORY (For Charts) ---
        const historyEntries = await dbAsync.all(
            'SELECT price, checked_at as date FROM price_history WHERE listing_id = ? ORDER BY checked_at ASC',
            [listing.id]
        );

        if (historyEntries.length >= 2) {
            const currentPrice = historyEntries[historyEntries.length - 1].price;
            const prevPrice = historyEntries[historyEntries.length - 2].price;
            const changeDate = new Date(historyEntries[historyEntries.length - 1].date);
            const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

            if (currentPrice < prevPrice && changeDate > fortyEightHoursAgo) {
                freshDiscount = true;
            }
        }
        // -------------------------
        // -------------------------

        // --- TECH DATA INFERENCE (Centralized Service) ---
        // Mutates listing object directly to clean Fuel, KM, Trans, Drive
        NormalizationService.normalizeListing(listing);

        // Extract for local variables used below
        const transmission = listing.transmission;
        const drive = listing.drive;
        const fuel = listing.fuel;
        const km = listing.km;



        const engine = extractEngine(listing);
        const equip = extractEquipmentScore(listing);
        const keywordCheck = checkBadKeywords(listing);

        // 1. Find Best Match Median within Mileage Segments
        let medianPrice = null;
        let matchAccuracy = 'broad';
        let refKm = 0;

        // Listing's mileage segment mapping (Tiers)
        let kmSegmentKey = 'mid';
        let kmSegmentLabel = 'Mid (100k-200k)';



        if (listing.id === '186656829') {
            console.log('------------------------------------------------');
            console.log(`DEBUG TIGUAN: segment=${kmSegmentKey} refKm=${refKm}`);
            console.log(`DEBUG TIGUAN: Make:${make} Model:${model} Year:${listing.year} Engine:${engine} Equip:${equip.level}`);
        }

        if (listing.id === '186789320') {
            console.log('------------------------------------------------');
            console.log(`DEBUG X5_2019: segment=${kmSegmentKey} refKm=${refKm}`);
            console.log(`DEBUG X5_2019: Make:${make} Model:${model} Year:${listing.year} Engine:${engine} Equip:${equip.level} KM:${listing.km}`);
        }

        if (listing.km === null || listing.km === undefined) {
            // Missing KM: Assume Higher Mileage to prevent False Positive Golden Deals
            // Treating unknown KM as 0 was causing it to be compared with Low mileage cars (making it look cheap).
            kmSegmentKey = 'high1';
            kmSegmentLabel = 'High-Tier 1 (Unknown KM - Conservative)';
            refKm = 225000;
        } else if (listing.km < 100000) {
            kmSegmentKey = 'low';
            kmSegmentLabel = 'Low (0-100k)';
            refKm = 60000;
        } else if (listing.km < 200000) {
            kmSegmentKey = 'mid';
            kmSegmentLabel = 'Mid (100k-200k)';
            refKm = 150000;
        } else if (listing.km < 250000) {
            kmSegmentKey = 'high1';
            kmSegmentLabel = 'High-Tier 1 (200k-250k)';
            refKm = 225000;
        } else if (listing.km < 300000) {
            kmSegmentKey = 'high2';
            kmSegmentLabel = 'High-Tier 2 (250k-300k)';
            refKm = 275000;
        } else if (listing.km < 400000) {
            kmSegmentKey = 'level300';
            kmSegmentLabel = 'Level 300 (300k-400k)';
            refKm = 350000;
        } else if (listing.km < 500000) {
            kmSegmentKey = 'level400';
            kmSegmentLabel = 'Level 400 (400k-500k)';
            refKm = 450000;
        } else {
            kmSegmentLabel = 'Level 500 (Zombie Tier)';
            refKm = 550000;
        }

        if (listing.id === 'eu_AeR9ranDuFUa') {
            console.log('------------------------------------------------');
            console.log(`DEBUG X5: segment=${kmSegmentKey} refKm=${refKm}`);
            console.log(`DEBUG X5: Make:${make} Model:${model} Year:${listing.year} Engine:${engine} Equip:${equip.level}`);
        }

        // -------------------------------------------------------------
        // SANITY CHECK: SUSPICIOUSLY LOW MILEAGE (TYPO DETECTOR)
        // -------------------------------------------------------------
        const checkAge = Math.max(0, new Date().getFullYear() - listing.year);
        const estimatedNewPrice = estimateOriginalPrice(listing);

        let isTyposSuspect = false;
        // Age >= 3 (e.g. 2023 or older in 2026), KM < 5000, Price < 65% of New
        if (checkAge >= 3 && listing.km < 5000 && listing.price < (estimatedNewPrice * 0.65)) {
            kmSegmentKey = 'high1'; // Force into 200k-250k segment
            kmSegmentLabel = 'High-Tier 1 (Suspected Typo)'; // Label updated
            refKm = 225000;
            isTyposSuspect = true;
        }
        // -------------------------------------------------------------

        // Check specific match including kmSegmentKey
        const specificMatch = marketValues.specific?.[make]?.[model]?.[listing.year]?.[engine]?.[equip.level]?.[kmSegmentKey];
        const broadMatch = marketValues.broad?.[make]?.[model]?.[listing.year]?.[kmSegmentKey];

        // Always try to get a reliable reference KM from broad stats if possible
        if (broadMatch && broadMatch.avgKm) {
            refKm = broadMatch.avgKm;
        } else if (specificMatch && specificMatch.avgKm) {
            refKm = specificMatch.avgKm;
        }

        // Use Specific Match ONLY if sample size is decent (>= 5), otherwise Broad is safer
        if (specificMatch && specificMatch.count >= 5) {
            medianPrice = specificMatch.medianPrice;
            matchAccuracy = 'specific';
        } else {
            if (broadMatch) {
                // FALLBACK: Use minPrice if sample size is too small (< 3) to avoid outlier skew
                if (broadMatch.count < 3) {
                    medianPrice = broadMatch.minPrice;
                } else {
                    medianPrice = broadMatch.medianPrice;
                }
                // matchAccuracy stays 'broad'
            }
        }

        // Final fallback to any kmSegment in broad if specific one failed


        if (!medianPrice) {
            // CRITICAL FIX: Do not fallback for high-mileage cars (Zombie tiers) using low-mileage data
            // This prevents comparing a 350k km car with 150k km prices.
            if (['level300', 'level400', 'zombie'].includes(kmSegmentKey)) {
                // Push as UN SCORED listing to ensure DB is cleared
                scoredListings.push({
                    ...listing,
                    score: 0,
                    dealType: null,
                    discount: 0,
                    make,
                    model,
                    engine,
                    transmission,
                    drive,
                    equipLevel: equip.level,
                    seller: null, // sellerAnalysis not available yet
                    liquidity: null,
                    risk: { score: 0, level: 'Nízke', color: '#00ff88' }, // riskScore not available yet
                    aiVerdict: null,
                    aiRiskLevel: null,
                    isFiltered: true // Treat as filtered so it doesn't show up
                });
                continue;
            }

            const anyYearData = marketValues.broad?.[make]?.[model]?.[listing.year];
            if (anyYearData) {
                const firstFound = Object.values(anyYearData)[0];
                medianPrice = firstFound.medianPrice;
                // Since we fall back to a different segment, we keep our tier's refKm
            }
        }



        if (!medianPrice) {
            // NO MARKET DATA FOUND - PUSH CLEARED RECORD
            scoredListings.push({
                ...listing,
                score: 0,
                dealType: null,
                discount: 0,
                make,
                model,
                engine,
                transmission,
                drive,
                equipLevel: equip.level,
                seller: null,
                liquidity: null,
                risk: { score: 0, level: 'Nízke', color: '#00ff88' },
                aiVerdict: null,
                aiRiskLevel: null,
                isFiltered: true
            });
            continue;
        }

        // ---------------------------------------------------------
        // TYPO CORRECTION PENALTY
        // If we suspect 200k km but data gave us 100k km price (fallback), we must punish the price.
        if (isTyposSuspect) {
            medianPrice *= 0.75; // -25% value adjustment for ~200k km reality
        }
        // ---------------------------------------------------------

        let correctedMedian = medianPrice;
        const age = Math.max(1, currentYear - listing.year);

        // 2. APPLY SPECIFIC TIER PENALTIES
        if (kmSegmentKey === 'high2') {
            if (age > 12) {
                correctedMedian *= 0.70; // -30% for old high-mileage cars (High Risk)
            } else {
                correctedMedian *= 0.85; // -15% standard
            }
        } else if (kmSegmentKey === 'level400') {
            correctedMedian *= 0.50; // -50%
        } else if (kmSegmentKey === 'zombie') {
            correctedMedian = Math.max(1000, medianPrice * 0.15); // Fixed scrap price or 15% of median
        }

        // 3. KM PENALTY (Dynamic)
        // 3. KM PENALTY (Dynamic & Intra-Bucket)
        // ---------------------------------------------------------
        const kmAboveRef = (listing.km || refKm) - refKm;

        // FIX: Intra-Bucket Depreciation
        // If listing has MORE km than the average of its group (refKm), apply progressive penalty
        if (kmAboveRef > 0 && kmSegmentKey !== 'zombie') {
            const rangeStep = 10000;
            const steps = kmAboveRef / rangeStep;

            // Standard rate: 2.5% per 10k km
            let baseRate = 0.025;

            // Progressivity: If outlier (>15k over avg), increase pain
            if (kmAboveRef > 15000) baseRate *= 1.5;

            let penaltyPercent = steps * baseRate;

            // AGE PENALTY: Double penalty for cars older than 12 years
            if (age > 12) {
                penaltyPercent *= 2;
            }

            // Cap max penalty to avoid negative numbers (max 40%)
            penaltyPercent = Math.min(0.40, penaltyPercent);

            correctedMedian *= (1 - penaltyPercent);
        }

        // FIX: The 200k Barrier (Pre-Service Zone)
        // Premium cars 160k-200k often face big service bills -> Market discounts them
        const isPremiumBrand = ['BMW', 'Audi', 'Mercedes-Benz', 'Porsche', 'Land Rover', 'Jaguar', 'Volvo'].includes(make);
        if (isPremiumBrand && listing.km > 160000 && listing.km < 200000) {
            correctedMedian *= 0.94; // -6% Pre-Service Discount
        }
        // ---------------------------------------------------------

        // 4. EQUIPMENT BONUS & RISK
        if (matchAccuracy === 'broad' && kmSegmentKey !== 'level400' && kmSegmentKey !== 'zombie') {
            // Filter features for RISK: over 250k km, 4x4 is a risk, not a value add
            const filteredFeatures = (listing.features || []).filter(f => {
                if (listing.km > 250000 && (f === '4x4' || f === 'Automat')) return false;
                return true;
            });

            // Adjust equip level bonus based on remaining features
            if (equip.level === 'Full') correctedMedian *= 1.12;
            else if (equip.level === 'Medium') correctedMedian *= 1.05;
        }

        // ---------------------------------------------------------
        // WEAK ENGINE PENALTY (SUV with small petrol engine)
        // ---------------------------------------------------------
        const isSUV = ['Tiguan', 'X5', 'X3', 'Kodiaq', 'Karoq', 'Touareg', 'Q7', 'Q5', 'Sportage', 'Tucson'].includes(model);
        const kw = listing.power; // Assumed parsed in standardizing
        // If SUV and Petrol and Weak (<110kW for Tiguan/Karoq sized, or <150kW for big ones)
        // Simple heuristic: If "Benzín" and "Mid" or "Base" engine in SUV -> Penalty
        if (isSUV && engine.includes('Benzín') && (engine.includes('Base') || engine.includes('Mid'))) {
            // 1.4 TSI Tiguan falls here
            correctedMedian *= 0.80; // -20% for undesirable engine
        }
        // ---------------------------------------------------------

        // 5. YEAR SANITY CHECK
        const nextYearData = marketValues.broad?.[make]?.[model]?.[listing.year + 1]?.[kmSegmentKey];
        if (nextYearData && correctedMedian > nextYearData.medianPrice * 1.1) {
            correctedMedian = nextYearData.medianPrice * 1.05;
        }

        // ENSURE POSITIVE
        const minZombiePrice = Math.max(1000, medianPrice * 0.15);
        correctedMedian = Math.max(kmSegmentKey === 'zombie' ? minZombiePrice : medianPrice * 0.2, correctedMedian);

        // 6. Calculate Final Score & Deal Type
        const discount = ((correctedMedian - listing.price) / correctedMedian) * 100;

        // OUTLIER VALIDATION
        // If discount > 30%, check if median is not inflated by outliers
        if (discount > 30) {
            // Find other listings in the same group to compare
            // Quick heuristic: if listing price is < 50% of median, it's suspicious or median is wrong
            if (listing.price < correctedMedian * 0.5) {
                // Check if it's a "parts" car that slipped through
                if (listing.price < 2000 && listing.year > 2015) {
                    // Force Overpriced because it's likely a scam or parts
                    correctedMedian = listing.price;
                }
            }
        }
        let dealInfo = calculateDealType(discount);

        // DISABLE GOLDEN DEAL FOR ZOMBIE
        if (kmSegmentKey === 'zombie' && dealInfo.type === 'GOLDEN DEAL') {
            dealInfo = { type: 'FAIR PRICE', emoji: '⚖️', score: 50 };
        }

        // 6. Liquidity Score Engine
        const liquidity = calculateLiquidity(listing, discount, age);

        // 6.5 Seller Analysis & Negotiation
        const seller = analyzeSeller(listing, listings);
        const negotiationScore = calculateNegotiationScore(listing, seller, discount, dealInfo.type === 'GOLDEN DEAL');

        // 7. Calculate Final Score & Deal Type (existing logic)
        let finalScore = dealInfo.score;
        if (keywordCheck.isFiltered) {
            finalScore = 0; // STRICT FILTERING: 0 score for bad keywords
            filtered++;
            dealInfo = { type: 'FILTERED', emoji: '🚫', score: 0 }; // Update deal type too
        }

        // Explanation string
        const dealReason = `Segment: ${kmSegmentLabel} | Cena vs upravený medián: ${Math.round(discount)} %`;

        // Mileage Warning
        let mileageWarning = null;
        if (listing.km >= 500000) {
            mileageWarning = '💀 Kritický stav životnosti';
        } else if (listing.km >= 300000) {
            mileageWarning = '⚠️ Vysoký nájazd – preverte servisnú históriu';
        }



        // --- EXPERT VALUATION ---
        const pStart = estimateOriginalPrice(listing);
        let fairPriceVal = calculateDepreciation(pStart, listing.year, 'Standard');
        fairPriceVal = applyMileageCorrection(fairPriceVal, listing);
        let { price: finalFairPrice, features: expertFeatures } = applyFeatures(fairPriceVal, listing);
        if (finalFairPrice < 500) finalFairPrice = 500;

        const diffPercent = ((listing.price - finalFairPrice) / finalFairPrice) * 100;
        let verdictLabel = 'Férová cena';
        if (diffPercent < -15) verdictLabel = 'SUPER CENA';
        else if (diffPercent < -5) verdictLabel = 'Dobrá cena';
        else if (diffPercent > 20) verdictLabel = 'Predražené';
        else if (diffPercent > 10) verdictLabel = 'Vyššia cena';

        const cons = [];
        if (listing.km > 200000) cons.push('Vysoký nájazd (>200k)');
        if (!listing.location) cons.push('Chýba lokácia');

        const expertAnalysis = `
### 🧐 Expertný Odhad
**Odhadovaná Férová Cena:** ${finalFairPrice.toLocaleString()} € - ${(finalFairPrice * 1.1).toLocaleString()} €
**Pôvodná cena (odhad):** ${pStart.toLocaleString()} €
**Verdikt:** ${verdictLabel} (${diffPercent > 0 ? '+' : ''}${Math.round(diffPercent)}% vs odhad)

**Plusy:**
${expertFeatures.length > 0 ? expertFeatures.map(p => `- ${p}`).join('\n') : '- Štandardná výbava'}

**Poznámky:**
${cons.length > 0 ? cons.map(c => `- ${c}`).join('\n') : '- Bez zjavných rizík z popisu'}
        `.trim();
        // -----------------------

        const risk = calculateRiskScore(listing, correctedMedian);
        const aiRiskLevel = Math.round(risk.score / 10); // Scale 0-100 to 0-10

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
            mileageWarning,
            liquidity,
            seller,
            negotiationScore,
            dealType: dealInfo.type,
            priceTrend,
            freshDiscount,
            priceHistory: historyEntries,
            risk,
            aiRiskLevel, // ADDED
            aiVerdict: expertAnalysis,
            score: finalScore,
            isFiltered: keywordCheck.isFiltered,
            transmission: transmission, // Inferred or original
            drive: drive,               // Inferred or original
            fuel: fuel,                 // Inferred or original
            km: km,                     // Inferred or original
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

async function run() {
    console.log('🤖 Scoring Agent - STARTED\n');
    const { dbAsync } = require('./database');

    // Load market values
    if (!fs.existsSync(CONFIG.MARKET_VALUES_FILE)) {
        console.error(`❌ Market values file not found: ${CONFIG.MARKET_VALUES_FILE}`);
        console.log('💡 Run market_value_agent.js first to generate market values.');
        process.exit(1);
    }

    // Load listings from Database instead of JSON
    let listings = await dbAsync.all('SELECT * FROM listings');

    const marketValuesData = fs.readFileSync(CONFIG.MARKET_VALUES_FILE, 'utf-8');
    const marketValues = JSON.parse(marketValuesData);

    console.log(`📁 Loaded ${listings.length} raw listings from Database`);
    console.log(`📁 Loaded market values database\n`);

    // Score listings (ALL of them)
    const { scoredListings, goldenDeals: totalGolden, goodDeals: totalGood, filtered } = await scoreListings(listings, marketValues, dbAsync);

    // Save scores back to Database (Update ALL listings)
    console.log(`💾 Saving scores back to Database...`);
    const { analyzeListingDescription } = require('./services/aiService');

    let count = 0;
    for (const scored of scoredListings) {
        count++;
        if (count % 200 === 0) console.log(`   ⏳ Updated ${count}/${scoredListings.length} listings...`);

        await dbAsync.run(
            'UPDATE listings SET deal_score = ?, liquidity_score = ?, risk_score = ?, engine = ?, equip_level = ?, ai_verdict = ?, ai_risk_level = ?, deal_type = ?, discount = ?, corrected_median = ?, negotiation_score = ?, transmission = ?, drive = ?, fuel = ?, km = ?, seller_type = ?, make = ?, model = ? WHERE id = ?',
            [
                scored.score,
                scored.liquidity ? scored.liquidity.score : null,
                scored.risk ? scored.risk.score : 0,
                scored.engine,
                scored.equipLevel,
                scored.aiVerdict || null,
                scored.aiRiskLevel || null,
                scored.dealType || null,
                scored.discount || null,
                scored.correctedMedian || null,
                scored.negotiationScore || 0,
                scored.transmission,
                scored.drive,
                scored.fuel,
                scored.km,
                (scored.seller && scored.seller.isPrivate) ? 'Private' : 'Dealer', // Map to DB format
                scored.make,
                scored.model,
                scored.id
            ]
        );
    }
    console.log(`✅ All ${scoredListings.length} listings updated in Database.`);

    // Deduplicate for Reports/JSON/Notifications
    const uniqueScoredListings = deduplicateListings(scoredListings);

    // Sort by score
    uniqueScoredListings.sort((a, b) => b.score - a.score);

    // Recalculate stats for unique
    const goldenDeals = uniqueScoredListings.filter(l => l.dealType === 'GOLDEN DEAL' && !l.isFiltered).length;
    const goodDeals = uniqueScoredListings.filter(l => l.dealType === 'GOOD DEAL' && !l.isFiltered).length;

    // Save scored listings (unique only)
    fs.writeFileSync(CONFIG.SCORED_LISTINGS_FILE, JSON.stringify(uniqueScoredListings, null, 2));

    // Save summary metadata for dashboard statistics
    const metadata = {
        totalAnalyzed: listings.length,
        goldenFound: goldenDeals,
        lastUpdate: new Date().toISOString()
    };
    fs.writeFileSync(path.join(__dirname, 'scored_listings_metadata.json'), JSON.stringify(metadata, null, 2));

    console.log(`💾 Scored listings saved to ${CONFIG.SCORED_LISTINGS_FILE}`);
    console.log(`💾 JS Data saved to scored_listings_data.js (for local dashboard)`);
    console.log(`💾 Metadata saved to scored_listings_metadata.json\n`);

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

// ========================================
// EXPORTS
// ========================================
module.exports = {
    scoreListings,
    extractMakeModel,
    calculateRiskScore,
    CONFIG
};

// ========================================
// MAIN EXECUTION (only if run directly)
// ========================================
if (require.main === module) {
    run();
}


