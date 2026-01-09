const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { dbAsync, upsertListing } = require('./database');

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// SAFETY: Force exit after 15 minutes to prevent zombie processes
setTimeout(() => {
    console.error('⚠️ [SAFETY] Force exiting scraper agent after 15 minutes timeout.');
    process.exit(1);
}, 15 * 60 * 1000);


// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    BASE_URL: 'https://auto.bazos.sk/',
    MIN_INTERVAL: 60000,  // 60 seconds
    MAX_INTERVAL: 120000, // 120 seconds
    LISTINGS_FILE: path.join(__dirname, 'listings.json'),
    COOKIES_FILE: path.join(__dirname, 'cookies.json'),
    SEARCH_CONFIGS_FILE: path.join(__dirname, 'search_configs.json'),
};

// Pool of realistic User-Agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Pool of realistic Referer headers
const REFERERS = [
    'https://www.google.sk/',
    'https://www.google.sk/search?q=bazos+auta',
    'https://www.google.com/',
    'https://www.bazos.sk/',
    'https://auto.bazos.sk/',
    'https://auto.bazos.sk/?hledat=auto',
];

// ========================================
// UTILITY FUNCTIONS
// ========================================

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomReferer() {
    return REFERERS[Math.floor(Math.random() * REFERERS.length)];
}

function randomViewport() {
    return {
        width: randomInt(1280, 1920),
        height: randomInt(720, 1080)
    };
}

async function randomDelay(min = 500, max = 2000) {
    const delay = randomInt(min, max);
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function humanScroll(page) {
    const scrollAmount = randomInt(300, 800);
    await page.evaluate((amount) => {
        window.scrollBy(0, amount);
    }, scrollAmount);
    await randomDelay(300, 800);
}

function loadListings() {
    if (fs.existsSync(CONFIG.LISTINGS_FILE)) {
        const data = fs.readFileSync(CONFIG.LISTINGS_FILE, 'utf-8');
        return JSON.parse(data);
    }
    return [];
}

function saveListings(listings) {
    fs.writeFileSync(CONFIG.LISTINGS_FILE, JSON.stringify(listings, null, 2));
}

function loadCookies() {
    if (fs.existsSync(CONFIG.COOKIES_FILE)) {
        const data = fs.readFileSync(CONFIG.COOKIES_FILE, 'utf-8');
        return JSON.parse(data);
    }
    return [];
}

function saveCookies(cookies) {
    fs.writeFileSync(CONFIG.COOKIES_FILE, JSON.stringify(cookies, null, 2));
}

// ========================================
// SCRAPER LOGIC
// ========================================

async function scrapeBazos(searchConfig = null) {
    const queryName = searchConfig ? searchConfig.name : 'Homepage';
    console.log(`\n🚀 [${new Date().toLocaleString('sk-SK')}] Starting scrape for: ${queryName}...`);

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();

    // Set random viewport
    const viewport = randomViewport();
    await page.setViewport(viewport);
    console.log(`📱 Viewport: ${viewport.width}x${viewport.height}`);

    // Set random user agent
    const userAgent = randomUserAgent();
    await page.setUserAgent(userAgent);
    console.log(`🎭 User-Agent: ${userAgent.substring(0, 50)}...`);

    // Set Slovak locale, timezone, and random referer
    const referer = randomReferer();
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'sk-SK,sk;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': referer
    });
    console.log(`🔗 Referer: ${referer}`);

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'language', { get: () => 'sk-SK' });
        Object.defineProperty(navigator, 'languages', { get: () => ['sk-SK', 'sk', 'en-US', 'en'] });
    });

    // Load cookies if available (returning visitor simulation)
    const cookies = loadCookies();
    if (cookies.length > 0) {
        await page.setCookie(...cookies);
        console.log(`🍪 Loaded ${cookies.length} cookies (returning visitor)`);
    }

    let allNewListings = [];
    const MAX_PAGES = 8; // Scrape 8 pages per run
    const startPage = process.argv[2] ? parseInt(process.argv[2]) : 0;

    for (let pageNum = startPage; pageNum < startPage + MAX_PAGES; pageNum++) {
        const offset = pageNum * 20;
        let searchUrl;
        if (searchConfig && searchConfig.query) {
            searchUrl = `${CONFIG.BASE_URL}?hledat=${encodeURIComponent(searchConfig.query)}`;
            if (searchConfig.priceFrom) searchUrl += `&cenaod=${searchConfig.priceFrom}`;
            if (searchConfig.priceTo) searchUrl += `&cenado=${searchConfig.priceTo}`;
            if (offset > 0) {
                searchUrl += `&strana=${offset}`;
            }
        } else {
            // Path based pagination for homepage
            searchUrl = offset > 0 ? `${CONFIG.BASE_URL}${offset}/` : CONFIG.BASE_URL;
        }

        console.log(`\n🌐 [Page ${pageNum + 1}/${MAX_PAGES}] Navigating to: ${searchUrl}`);

        try {
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        } catch (e) {
            console.log(`⚠️ Error loading page ${pageNum + 1}: ${e.message}`);
            continue;
        }

        // Random delay after page load (human-like)
        await randomDelay(1000, 2500);

        // Human-like scrolling
        await humanScroll(page);

        // Wait for listings
        try {
            await page.waitForSelector('.inzeraty', { timeout: 10000 });
        } catch (e) {
            console.log('⚠️ No listings found on page');
            break; // Stop if no listings found
        }

        // Extract listings
        console.log(`📍 Extracting listings from page ${pageNum + 1}...`);
        const extracted = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('div.inzeraty'));
            const results = [];

            items.forEach(item => {
                try {
                    // Extract title and link
                    const titleElem = item.querySelector('h2.nadpis a') || item.querySelector('.inzeratynadpis a');
                    if (!titleElem) return;

                    const title = titleElem.innerText.trim();
                    const link = titleElem.href.startsWith('http')
                        ? titleElem.href
                        : 'https://auto.bazos.sk' + titleElem.getAttribute('href');

                    // Extract ID from URL (e.g., /inzerat/123456789/...)
                    const idMatch = link.match(/\/inzerat\/(\d+)\//);
                    if (!idMatch) return;
                    const id = idMatch[1];

                    // Extract price
                    const priceElem = item.querySelector('div.inzeratycena');
                    if (!priceElem) return;
                    const priceText = priceElem.innerText.replace(/\s/g, '').replace('€', '').replace(/\D/g, '');
                    const price = parseInt(priceText);
                    if (!price || price < 1000) return;

                    // Extract description for year and km
                    const descElem = item.querySelector('div.popis');
                    const fullText = descElem ? descElem.innerText : '';
                    const combinedText = title + ' ' + fullText;
                    const lowerText = combinedText.toLowerCase();

                    // Extract Location
                    const locElem = item.querySelector('div.inzeratylok');
                    let location = locElem ? locElem.innerText.replace(/\n/g, ' ').trim() : null;
                    if (location && location.includes('<br>')) { // Sometimes innerText doesn't capture the break well
                        location = locElem.innerHTML.replace(/<br>/g, ' ').replace(/<[^>]*>/g, '').trim();
                    }

                    // Extract Seller Name from rating link if possible
                    let sellerName = null;
                    const ratingElem = item.querySelector('span[onclick*="rating"]');
                    if (ratingElem) {
                        const onclick = ratingElem.getAttribute('onclick');
                        const match = onclick.match(/'rating','\d+','\d+','([^']+)'/);
                        if (match) sellerName = match[1];
                    }

                    // Extract VIN
                    const vinMatch = combinedText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
                    const vin = vinMatch ? vinMatch[0] : null;

                    // Extract Transmission
                    let transmission = null;
                    if (lowerText.match(/automat|dsg|tiptronic|s-tronic|stronic|7g-tronic|9g-tronic/)) transmission = 'Automat';
                    else if (lowerText.match(/manuál|manual|6st\.|5st\./)) transmission = 'Manuál';

                    // Extract Fuel
                    let fuel = null;
                    if (lowerText.match(/diesel|nafta|tdi|crd|cdti/)) fuel = 'Diesel';
                    else if (lowerText.match(/benzín|benzin|tsi|tfsi|fsi|mpi/)) fuel = 'Benzín';
                    else if (lowerText.match(/elektro|electric|ev/)) fuel = 'Elektro';
                    else if (lowerText.match(/hybrid/)) fuel = 'Hybrid';
                    else if (lowerText.match(/lpg/)) fuel = 'LPG';

                    // Extract Drive
                    let drive = null;
                    if (lowerText.match(/4x4|4wd|awd|quattro|4motion|x-drive|xdrive|allgrip/)) drive = '4x4';
                    else if (lowerText.match(/zadný|zadny|rwd/)) drive = 'Zadný';
                    else drive = 'Predný'; // Default assumption

                    // Extract Power
                    const powerMatch = lowerText.match(/(\d{2,3})\s*(kw|k|ps|hp)\b/);
                    const power = powerMatch ? powerMatch[1] + ' kW' : null;

                    // Extract year
                    let year = null;
                    const yearMatches = [
                        combinedText.match(/rok?\s*(\d{4})/i),
                        combinedText.match(/r\.?v\.?\s*(\d{4})/i),
                        combinedText.match(/\b(20\d{2})\b/),
                        combinedText.match(/(\d{4})\s*$/m)
                    ];

                    for (const match of yearMatches) {
                        if (match) {
                            const y = parseInt(match[1]);
                            if (y >= 2000 && y <= 2026) {
                                year = y;
                                break;
                            }
                        }
                    }

                    // Extract km
                    let km = null;
                    const kmMatches = [
                        combinedText.match(/(?:najazdené|nájazd|najazd)[\s:]*(\d[\d\s.]*)(\s*)km/i),
                        combinedText.match(/(\d[\d\s.]*)\s*(?:tis\.|tisíc)\s*km/i),
                        combinedText.match(/(\d{4,6})\s*km/i),
                        combinedText.match(/(\d[\d\s.]+)\s*km/i)
                    ];

                    for (const match of kmMatches) {
                        if (match) {
                            let kmValue = parseInt(match[1].replace(/[\s.]/g, ''));

                            if (combinedText.toLowerCase().includes('tis.') || combinedText.toLowerCase().includes('tisíc')) {
                                if (kmValue < 1000) {
                                    kmValue = kmValue * 1000;
                                }
                            }

                            if (kmValue > 0 && kmValue < 1000000) {
                                km = kmValue;
                                break;
                            }
                        }
                    }

                    results.push({
                        id,
                        title,
                        price,
                        year,
                        km,
                        url: link,
                        location,
                        seller_name: sellerName,
                        vin,
                        transmission,
                        fuel,
                        drive,
                        power,
                        portal: 'Bazos'
                    });

                } catch (e) {
                    console.error('Error extracting item:', e.message);
                }
            });

            return results;
        });

        // ENRICHMENT: Visit detail pages for incomplete listings
        for (const listing of extracted) {
            const isIncomplete = !listing.year || !listing.km || !listing.location;
            if (isIncomplete) {
                console.log(`🔍 [Enriching] ${listing.title}...`);
                try {
                    const detailPage = await browser.newPage();
                    await detailPage.setUserAgent(randomUserAgent());
                    await detailPage.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    const detailData = await detailPage.evaluate(() => {
                        const table = document.querySelector('table.listatabulka');
                        const cells = table ? Array.from(table.rows).map(r => ({
                            label: r.cells[0]?.innerText.toLowerCase() || '',
                            value: r.cells[1]?.innerText || ''
                        })) : [];

                        const getVal = (label) => cells.find(c => c.label.includes(label))?.value.trim();

                        // Bazos detail page often lists info in a specific table or just description
                        const bodyText = document.body.innerText;

                        return {
                            kmDetail: bodyText.match(/(\d+[\s.]*)\s*(?:km|tis\.)/i)?.[0],
                            yearDetail: bodyText.match(/\b(20\d{2})\b/)?.[1],
                            locationDetail: document.querySelector('.vypis .listalok')?.innerText.trim(),
                            sellerNameDetail: document.querySelector('.vypis .listameno a')?.innerText.trim()
                        };
                    });

                    if (!listing.year && detailData.yearDetail) listing.year = parseInt(detailData.yearDetail);
                    if (!listing.km && detailData.kmDetail) {
                        const kmVal = parseInt(detailData.kmDetail.replace(/\D/g, ''));
                        listing.km = detailData.kmDetail.toLowerCase().includes('tis') ? kmVal * 1000 : kmVal;
                    }
                    if (!listing.location && detailData.locationDetail) listing.location = detailData.locationDetail;
                    if (!listing.seller_name && detailData.sellerNameDetail) listing.seller_name = detailData.sellerNameDetail;

                    await detailPage.close();
                    await randomDelay(800, 1500);
                } catch (err) {
                    console.log(`⚠️ Enrichment failed for ${listing.id}: ${err.message}`);
                }
            }
        }

        console.log(`✅ Found ${extracted.length} listings on page ${pageNum + 1}`);
        allNewListings.push(...extracted);

        // Pause between pages to be safe
        if (pageNum < MAX_PAGES - 1) {
            const delay = randomInt(3000, 7000);
            console.log(`⏸️  Waiting ${delay}ms before next page...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Save cookies for next session
    const currentCookies = await page.cookies();
    saveCookies(currentCookies);

    await browser.close();

    // Secondary filtering based on searchConfig years if available
    if (searchConfig && (searchConfig.yearFrom || searchConfig.yearTo)) {
        allNewListings = allNewListings.filter(l => {
            if (!l.year) return true; // Keep if unknown to be safe
            if (searchConfig.yearFrom && l.year < searchConfig.yearFrom) return false;
            if (searchConfig.yearTo && l.year > searchConfig.yearTo) return false;
            return true;
        });
    }

    // Process listings - filter duplicates and save to DB
    const { upsertListing } = require('./database');

    let newCount = 0;
    for (const listing of allNewListings) {
        // We now rely on database for deduplication and price history
        await upsertListing(listing);
        newCount++;
    }

    // LEGACY JSON SUPPORT (Triggered agents rely on this file)
    if (newCount > 0) {
        try {
            const currentJson = loadListings();
            // Simple merge strategy for JSON
            const merged = [...allNewListings, ...currentJson].slice(0, 2000); // Keep last 2000
            saveListings(merged);
            console.log('💾 Updated listings.json for legacy agents.');
        } catch (e) { console.error('JSON Save Error:', e.message); }
    }

    // FEATURE GATING: Trigger Analysis & Notifications ONLY if Premium User exists
    try {
        const premiumUser = await dbAsync.get("SELECT id FROM users WHERE subscription_status = 'premium' LIMIT 1");

        if (true || premiumUser) { // DISABLED CHECK FOR DEBUGGING
            console.log('💎 Premium check bypassed. Triggering AI & Notifications Pipeline...');

            exec('node scoring_agent.js', (err, stdout, stderr) => {
                if (err) { console.error('Scoring Error:', err.message); return; }
                if (stdout) console.log('Scoring:', stdout.substring(0, 100));

                // Chain Communication Agent
                exec('node communication_agent.js', (err2, stdout2) => {
                    if (err2) console.error('Communication Error:', err2.message);
                    if (stdout2) console.log('Communicator:', stdout2);
                });
            });
        } else {
            console.log('🔒 No Premium active. Skipping AI/Telegram (Save resources).');
        }
    } catch (e) {
        console.error('Feature Gating Error:', e.message);
    }

    if (newCount > 0) {
        console.log(`\n💾 Processed ${newCount} listing(s) into database.`);
    } else {
        console.log(`\n📊 No listings found across ${MAX_PAGES} pages.`);
    }
}

// ========================================
// MAIN LOOP
// ========================================

let isRunning = true;

async function mainLoop() {
    while (isRunning) {
        try {
            let configs = [null]; // Default to homepage
            if (fs.existsSync(CONFIG.SEARCH_CONFIGS_FILE)) {
                try {
                    const data = fs.readFileSync(CONFIG.SEARCH_CONFIGS_FILE, 'utf-8');
                    configs = [null, ...JSON.parse(data)]; // Homepage + configs
                } catch (e) {
                    console.error('⚠️ Could not parse search_configs.json');
                }
            }

            for (const config of configs) {
                if (!isRunning) break;
                await scrapeBazos(config);
                // Short break between different searches
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } catch (error) {
            console.error('❌ Error during main loop:', error.message);
        }

        if (!isRunning) break;

        // Random interval between 60-120 seconds
        const nextInterval = randomInt(CONFIG.MIN_INTERVAL, CONFIG.MAX_INTERVAL);
        const nextRunTime = new Date(Date.now() + nextInterval);
        console.log(`⏰ Next scrape in ${Math.round(nextInterval / 1000)}s at ${nextRunTime.toLocaleTimeString('sk-SK')}`);

        await new Promise(resolve => setTimeout(resolve, nextInterval));
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Ukončujem scraper agent... Dovidenia!');
    isRunning = false;
    process.exit(0);
});

// Start the agent
console.log('🤖 Bazos.sk Scraper Agent - STARTED');
console.log('📁 Listings file:', CONFIG.LISTINGS_FILE);
console.log('⏱️  Interval: 60-120 seconds (randomized)');
console.log('🛡️  Stealth: ENABLED');
console.log('Press CTRL+C to stop\n');

if (process.argv.includes('--once')) {
    (async () => {
        try {
            let configs = [null];
            if (fs.existsSync(CONFIG.SEARCH_CONFIGS_FILE)) {
                try {
                    const data = fs.readFileSync(CONFIG.SEARCH_CONFIGS_FILE, 'utf-8');
                    configs = [null, ...JSON.parse(data)];
                } catch (e) { }
            }
            for (const config of configs) {
                await scrapeBazos(config);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            console.log('\n✅ Single pass completed.');
            process.exit(0);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    })();
} else {
    mainLoop();
}
