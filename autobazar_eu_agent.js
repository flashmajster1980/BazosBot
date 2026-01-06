const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const CONFIG = {
    BASE_URL: 'https://www.autobazar.eu/',
    LISTINGS_FILE: path.join(__dirname, 'listings.json'),
    MAX_PAGES: 3,
    SEARCH_CONFIGS_FILE: path.join(__dirname, 'search_configs.json'),
};

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];

async function scrapeAutobazar(searchConfig = null) {
    const queryName = searchConfig ? searchConfig.name : 'Latest Cars';
    console.log(`\n🚀 [Autobazar.eu] Starting scrape for: ${queryName}...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);

        // Block images to save bandwidth and potentially avoid some trackers
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.resourceType() === 'image') req.abort();
            else req.continue();
        });

        let allNewListings = [];

        for (let pageNum = 1; pageNum <= CONFIG.MAX_PAGES; pageNum++) {
            let searchUrl = '';
            if (searchConfig && searchConfig.query) {
                searchUrl = `${CONFIG.BASE_URL}vysledky/?keyword=${encodeURIComponent(searchConfig.query)}`;
                if (pageNum > 1) searchUrl += `&page=${pageNum}`;
            } else {
                searchUrl = `${CONFIG.BASE_URL}vysledky-najnovsie/osobne-vozidla/`;
                if (pageNum > 1) searchUrl += `?page=${pageNum}`;
            }

            console.log(`🌐 [Page ${pageNum}/${CONFIG.MAX_PAGES}] Navigating to: ${searchUrl}`);

            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await new Promise(r => setTimeout(r, 5000));

            // Handle cookie banner - look for "Prijať všetko"
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a, span'));
                const accept = buttons.find(b => b.innerText && (b.innerText.includes('Prijať všetko') || b.innerText.includes('Prijat vsetko')));
                if (accept) {
                    if (accept.tagName === 'BUTTON') accept.click();
                    else accept.parentElement.click();
                }
            });
            await new Promise(r => setTimeout(r, 2000));

            const extracted = await page.evaluate(() => {
                const results = [];
                // Find all detail links
                const detailLinks = Array.from(document.querySelectorAll('a'))
                    .filter(a => a.href && a.href.includes('/detail') && !a.href.includes('/detail-porovnanie'));

                detailLinks.forEach(link => {
                    try {
                        // Find a container that has price and year/km
                        let card = link.parentElement;
                        let depth = 0;
                        while (card && card.tagName !== 'BODY' && depth < 10) {
                            if (card.innerText.includes('€') && (card.innerText.includes('km') || card.innerText.match(/\d{4}/))) {
                                break;
                            }
                            card = card.parentElement;
                            depth++;
                        }

                        if (!card || card.tagName === 'BODY' || depth >= 10) return;

                        const titleElem = card.querySelector('h2') || card.querySelector('span.font-semibold');
                        if (!titleElem) return;

                        const title = titleElem.innerText.trim();
                        const url = link.href;

                        // ID extraction
                        const idMatch = url.match(/\/detail.*\/([a-zA-Z0-9]+)\/$/) || url.match(/\/([a-zA-Z0-9]+)\/$/);
                        const id = 'eu_' + (idMatch ? idMatch[1] : Math.random().toString(36).substr(2, 9));

                        // Price
                        let price = null;
                        const priceMatch = card.innerText.match(/(\d[\d\s]*)\s*€/);
                        if (priceMatch) {
                            price = parseInt(priceMatch[1].replace(/\s/g, ''));
                        }
                        if (!price || price < 500) return;

                        // Year
                        const yearMatch = card.innerText.match(/\b(20\d{2}|19\d{2})\b/);
                        const year = yearMatch ? parseInt(yearMatch[1]) : null;

                        // KM
                        const kmMatch = card.innerText.match(/(\d[\d\s]*)\s*km/);
                        const km = kmMatch ? parseInt(kmMatch[1].replace(/\s/g, '')) : null;

                        // Transmission
                        let transmission = null;
                        if (card.innerText.match(/Automat/i)) transmission = 'Automat';
                        else if (card.innerText.match(/Manuál|Manual/i)) transmission = 'Manuál';

                        // Fuel
                        let fuel = null;
                        if (card.innerText.match(/Diesel/i)) fuel = 'Diesel';
                        else if (card.innerText.match(/Benzín|Benzin/i)) fuel = 'Benzín';
                        else if (card.innerText.match(/Elektro|Electric/i)) fuel = 'Elektro';
                        else if (card.innerText.match(/Hybrid/i)) fuel = 'Hybrid';

                        results.push({
                            id,
                            title,
                            price,
                            year,
                            km,
                            url,
                            transmission,
                            fuel,
                            portal: 'Autobazar.eu',
                            scrapedAt: new Date().toISOString()
                        });
                    } catch (e) { }
                });

                // Deduplicate by URL
                const unique = [];
                const seenUrls = new Set();
                results.forEach(item => {
                    if (!seenUrls.has(item.url)) {
                        seenUrls.add(item.url);
                        unique.push(item);
                    }
                });
                return unique;
            });

            console.log(`✅ Found ${extracted.length} listings.`);
            allNewListings.push(...extracted);

            if (extracted.length === 0) break;

            await new Promise(r => setTimeout(r, 4000 + Math.random() * 3000));
        }

        const existingData = fs.existsSync(CONFIG.LISTINGS_FILE) ? JSON.parse(fs.readFileSync(CONFIG.LISTINGS_FILE, 'utf-8')) : [];
        const existingIds = new Set(existingData.map(l => l.id));

        let newCount = 0;
        allNewListings.forEach(l => {
            if (!existingIds.has(l.id)) {
                existingData.push(l);
                existingIds.add(l.id);
                newCount++;
            }
        });

        fs.writeFileSync(CONFIG.LISTINGS_FILE, JSON.stringify(existingData, null, 2));
        console.log(`💾 Saved ${newCount} new listings from Autobazar.eu. Total items in DB: ${existingData.length}`);

    } catch (error) {
        console.error('❌ Error during Autobazar scraping:', error.message);
    } finally {
        await browser.close();
    }
}

async function run() {
    console.log('🤖 Autobazar.eu Agent - STARTED');

    let configs = [null];
    if (fs.existsSync(CONFIG.SEARCH_CONFIGS_FILE)) {
        try {
            configs = [null, ...JSON.parse(fs.readFileSync(CONFIG.SEARCH_CONFIGS_FILE, 'utf-8'))];
        } catch (e) { }
    }

    for (const config of configs) {
        await scrapeAutobazar(config);
        await new Promise(r => setTimeout(r, 10000));
    }

    console.log('\n✅ Autobazar.eu Agent - COMPLETED');
}

run();
