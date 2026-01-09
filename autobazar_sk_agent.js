const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const NormalizationService = require('./services/normalizationService');

puppeteer.use(StealthPlugin());

const CONFIG = {
    BASE_URL: 'https://www.autobazar.sk/',
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

async function scrapeAutobazarSK(searchConfig = null) {
    const queryName = searchConfig ? searchConfig.name : 'Latest Ads';
    console.log(`\n🚀 [Autobazar.sk] Starting scrape for: ${queryName}...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
            let searchUrl = '';
            if (searchConfig && searchConfig.query) {
                // Formatting query for their subdomained or keyword search
                // For simplicity, let's use the keyword search URL
                searchUrl = `https://www.autobazar.sk/vyhladavanie/?q=${encodeURIComponent(searchConfig.query)}`;
                if (pageNum > 1) searchUrl += `&p[page]=${pageNum}`;
            } else {
                searchUrl = `https://www.autobazar.sk/osobne-vozidla/`;
                if (pageNum > 1) searchUrl += `?p[page]=${pageNum}`;
            }

            console.log(`🌐 [Page ${pageNum}/${CONFIG.MAX_PAGES}] Navigating to: ${searchUrl}`);

            try {
                await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            } catch (e) {
                console.log(`⚠️ Navigation timeout, attempting to continue...`);
            }

            // Random human-like wait
            await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));

            // Random scroll
            await page.evaluate(() => {
                window.scrollBy(0, Math.floor(Math.random() * 500) + 200);
            });
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

            // Handle cookie banner
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a, span'));
                const accept = buttons.find(b => b.innerText && b.innerText.includes('Prijať všetko'));
                if (accept) {
                    if (accept.tagName === 'BUTTON') accept.click();
                    else accept.parentElement.click();
                }
            });
            await new Promise(r => setTimeout(r, 2000));

            const extracted = await page.evaluate(() => {
                const results = [];
                // More specific selector for listings
                const cards = Array.from(document.querySelectorAll('.item, [class*="ListingItem"]'));

                cards.forEach(card => {
                    try {
                        const titleLink = card.querySelector('.item-heading a, h2 a');
                        if (!titleLink) return;

                        const title = titleLink.innerText.trim();
                        const url = titleLink.href;

                        // ID extraction from URL
                        const idMatch = url.match(/-id(\d+)\.html/) || url.match(/\/(\d+)\/$/);
                        const id = 'sk_' + (idMatch ? idMatch[1] : Math.random().toString(36).substr(2, 9));

                        // Price - FIX: Extract only the first price found
                        const priceElem = card.querySelector('.price, [class*="Price"]');
                        let price = null;
                        if (priceElem) {
                            const priceText = priceElem.innerText.replace(/\s/g, '').replace('€', '');
                            const match = priceText.match(/^\d+/); // Just the first sequence of digits
                            price = match ? parseInt(match[0]) : null;
                        }
                        if (!price || price < 500 || price > 500000) return;

                        // Specific selectors for attributes
                        const tags = Array.from(card.querySelectorAll('.tagName, .tag-location, .tags span'));

                        let year = null;
                        let km = null;
                        let location = null;

                        tags.forEach(tag => {
                            const text = tag.innerText.trim();
                            if (text.startsWith('r.')) year = parseInt(text.replace('r.', '').trim());
                            else if (text.endsWith('km')) km = parseInt(text.replace(/\s/g, '').replace('km', ''));
                            else if (tag.classList.contains('tag-location') || text.includes('kraj')) location = text;
                        });

                        // Fallback to regex if selectors failed
                        const teaserText = card.innerText;
                        if (!year) {
                            const yearMatch = teaserText.match(/r\.\s*(20\d{2}|19\d{2})/);
                            if (yearMatch) year = parseInt(yearMatch[1]);
                        }
                        if (!km) {
                            const kmMatch = teaserText.match(/(\d[\d\s]*)\s*km/);
                            if (kmMatch) km = parseInt(kmMatch[1].replace(/\s/g, ''));
                        }
                        if (!location) {
                            const locMatch = teaserText.match(/([A-ZŽŠČŤŽ]{2})\s*kraj/i);
                            if (locMatch) location = locMatch[0];
                        }

                        // Seller Type
                        let sellerType = '👤 Súkromná osoba';
                        const isPrivate = card.querySelector('.ico-user');
                        const hasLogo = card.querySelector('.logo-wrapper, img[src*="logo"]');
                        const dealerLink = card.querySelector('a[href*="/predajca/"]');

                        if (!isPrivate || hasLogo || dealerLink) {
                            sellerType = '🏢 Bazár/Dealer';
                        }

                        results.push({
                            id,
                            title,
                            price,
                            year,
                            km,
                            url,
                            fuel,
                            location,
                            seller_type: sellerType,
                            portal: 'Autobazar.sk',
                            scrapedAt: new Date().toISOString()
                        });
                    } catch (e) { }
                });
                return results;
            });

            // ENRICHMENT: Visit detail pages for incomplete listings or to get City
            for (const listing of extracted) {
                const needsCity = listing.location && listing.location.includes('kraj');
                const isIncomplete = !listing.year || !listing.km || !listing.location;

                if (isIncomplete || needsCity) {
                    console.log(`🔍 [Enriching] ${listing.title}...`);
                    try {
                        const detailPage = await browser.newPage();
                        await detailPage.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
                        await detailPage.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                        const detailData = await detailPage.evaluate(() => {
                            const locElem = document.querySelector('.location-box, .contact-location, [class*="Location"]');
                            const sellerName = document.querySelector('.seller-name, [class*="SellerName"]')?.innerText.trim();

                            // Specific tags in detail
                            const detailTags = Array.from(document.querySelectorAll('.info-table td, .params-table .val'));

                            return {
                                locationDetail: locElem ? locElem.innerText.trim() : null,
                                sellerNameDetail: sellerName
                            };
                        });

                        if (detailData.locationDetail) listing.location = detailData.locationDetail;
                        if (detailData.sellerNameDetail && !listing.seller_name) listing.seller_name = detailData.sellerNameDetail;

                        await detailPage.close();
                        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
                    } catch (err) {
                        console.log(`⚠️ Enrichment failed for ${listing.id}: ${err.message}`);
                    }
                }
            }

            console.log(`✅ Found ${extracted.length} listings. Normalizing...`);
            extracted.forEach(l => NormalizationService.normalizeListing(l));

            allNewListings.push(...extracted);

            if (extracted.length === 0) break;

            await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
        }

        const { upsertListing } = require('./database');
        let newCount = 0;
        for (const l of allNewListings) {
            await upsertListing(l);
            newCount++;
        }

        console.log(`💾 Processed ${newCount} listings from Autobazar.sk into database.`);

    } catch (error) {
        console.error('❌ Error during Autobazar.sk scraping:', error.message);
    } finally {
        await browser.close();
    }
}

async function run() {
    console.log('🤖 Autobazar.sk Agent - STARTED');

    let configs = [null];
    if (fs.existsSync(CONFIG.SEARCH_CONFIGS_FILE)) {
        try {
            configs = [null, ...JSON.parse(fs.readFileSync(CONFIG.SEARCH_CONFIGS_FILE, 'utf-8'))];
        } catch (e) { }
    }

    for (const config of configs) {
        await scrapeAutobazarSK(config);
        await new Promise(r => setTimeout(r, 8000));
    }

    console.log('\n✅ Autobazar.sk Agent - COMPLETED');
}

run();
