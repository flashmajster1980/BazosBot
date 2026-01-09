const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const NormalizationService = require('./services/normalizationService');

puppeteer.use(StealthPlugin());

const CONFIG = {
    BASE_URL: 'https://www.autovia.sk/',
    LISTINGS_FILE: path.join(__dirname, 'listings.json'),
    MAX_PAGES: 8,
    SEARCH_CONFIGS_FILE: path.join(__dirname, 'search_configs.json'),
};

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
];

async function scrapeAutovia(searchConfig = null) {
    const queryName = searchConfig ? searchConfig.name : 'Latest Cars';
    console.log(`\n🚀 [Autovia.sk] Starting scrape for: ${queryName}...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    try {
        const page = await browser.newPage();

        // Random viewport
        const viewports = [
            { width: 1920, height: 1080 },
            { width: 1440, height: 900 },
            { width: 1366, height: 768 },
            { width: 1536, height: 864 }
        ];
        await page.setViewport(viewports[Math.floor(Math.random() * viewports.length)]);
        await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);

        // Block images
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.resourceType() === 'image') req.abort();
            else req.continue();
        });

        let allNewListings = [];

        for (let pageNum = 1; pageNum <= CONFIG.MAX_PAGES; pageNum++) {
            let searchUrl = `${CONFIG.BASE_URL}vysledky/osobne-vozidla/`;
            if (searchConfig && searchConfig.query) {
                const q = searchConfig.query.toLowerCase();
                if (q.includes('tesla')) searchUrl += 'tesla/model-3/';
                else if (q.includes('skoda')) searchUrl += 'skoda/octavia/';
                else if (q.includes('volkswagen')) searchUrl += 'volkswagen/tiguan/';
                else if (q.includes('bmw')) searchUrl += 'bmw/x5/';
            }

            if (pageNum > 1) {
                searchUrl += `${searchUrl.endsWith('/') ? '' : '/'}?page=${pageNum}`;
            }

            console.log(`🌐 [Page ${pageNum}/${CONFIG.MAX_PAGES}] Navigating to: ${searchUrl}`);

            try {
                await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

                // Random human-like wait
                await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));

                // Random scroll
                await page.evaluate(() => {
                    window.scrollBy(0, Math.floor(Math.random() * 500) + 200);
                });
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

                const extracted = await page.evaluate(() => {
                    const results = [];
                    const items = document.querySelectorAll('a.block.no-underline');

                    items.forEach(item => {
                        try {
                            const title = item.querySelector('h2')?.innerText.trim();
                            if (!title) return;

                            const url = item.href;
                            const idMatch = url.split('/').filter(Boolean).pop();
                            const id = 'autovia_' + idMatch;

                            const priceElem = item.querySelector('div.text-2xl.font-semibold');
                            const price = priceElem ? parseInt(priceElem.innerText.replace(/\s/g, '').replace('€', '').replace(/\D/g, '')) : null;

                            const yearElem = item.querySelector('span[aria-label*="Rok výroby"]');
                            const yearMatch = yearElem ? yearElem.innerText.match(/\d{4}/) : null;
                            const year = yearMatch ? parseInt(yearMatch[0]) : null;

                            const kmElem = item.querySelector('span[aria-label*="Najazdené km"]');
                            const km = kmElem ? parseInt(kmElem.innerText.replace(/\s/g, '').replace('km', '').replace(/\D/g, '')) : null;

                            const infoSpans = Array.from(item.querySelectorAll('div.flex.flex-wrap span'));
                            let location = null;
                            infoSpans.forEach(span => {
                                const t = span.innerText.trim();
                                if (t.includes('kraj') || t.includes('okres')) location = t;
                            });

                            results.push({
                                id,
                                title,
                                price,
                                year,
                                km,
                                location,
                                url,
                                portal: 'Autovia.sk',
                                scrapedAt: new Date().toISOString(),
                                seller_type: '👤 Súkromná osoba'
                            });
                        } catch (e) { }
                    });
                    return results;
                });

                console.log(`✅ Found ${extracted.length} listings. Normalizing...`);
                extracted.forEach(l => NormalizationService.normalizeListing(l));

                allNewListings.push(...extracted);

                if (extracted.length === 0) break;

            } catch (err) {
                console.error(`❌ Error fetching page ${pageNum}:`, err.message);
                break;
            }

            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }

        const { upsertListing } = require('./database');
        let newCount = 0;
        for (const l of allNewListings) {
            await upsertListing(l);
            newCount++;
        }
        console.log(`💾 Processed ${newCount} listings from Autovia.sk into database.`);

    } catch (error) {
        console.error('❌ Error during Autovia.sk scraping:', error.message);
    } finally {
        await browser.close();
    }
}

async function run() {
    console.log('🤖 Autovia.sk Agent (Puppeteer) - STARTED');
    let configs = [null];
    if (fs.existsSync(CONFIG.SEARCH_CONFIGS_FILE)) {
        try {
            configs = [null, ...JSON.parse(fs.readFileSync(CONFIG.SEARCH_CONFIGS_FILE, 'utf-8'))];
        } catch (e) { }
    }
    for (const config of configs) {
        await scrapeAutovia(config);
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
    }
    console.log('✅ Autovia.sk Agent - COMPLETED');
}

run();
