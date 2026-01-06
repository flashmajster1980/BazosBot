const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const CONFIG = {
    LISTINGS_FILE: path.join(__dirname, 'listings.json'),
    SCORED_FILE: path.join(__dirname, 'scored_listings.json'),
    CHECK_LIMIT: 50, // Check max 50 listings per run to save time
};

async function checkListing(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

        // Bazos specific "not found" indicators
        const isNotFound = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            // Check for typical Bazos "removed" messages
            return bodyText.includes('Inzerát bol odstránený') ||
                bodyText.includes('Inzerát nenalezen') ||
                document.title.includes('Bazoš - chyba') ||
                window.location.href === 'https://auto.bazos.sk/' ||
                document.querySelectorAll('.inzeratydetail').length === 0;
        });

        return !isNotFound;
    } catch (e) {
        console.log(`⚠️ Error checking ${url}: ${e.message}`);
        return true; // Assume it exists if error (to be safe)
    }
}

async function run() {
    console.log('🤖 Sold Detection Agent - STARTED\n');

    if (!fs.existsSync(CONFIG.LISTINGS_FILE)) {
        console.log('❌ Listings file not found.');
        return;
    }

    let listings = JSON.parse(fs.readFileSync(CONFIG.LISTINGS_FILE, 'utf-8'));
    let scoredListings = fs.existsSync(CONFIG.SCORED_FILE) ? JSON.parse(fs.readFileSync(CONFIG.SCORED_FILE, 'utf-8')) : [];

    // Filter listings that are NOT already marked as sold and were scraped more than 1 hour ago
    // (to avoid checking brand new ones immediately)
    const now = new Date();
    const activeListings = listings.filter(l => !l.isSold);

    // Pick listings to check: prioritze those not checked for a long time
    // or just the oldest ones. For simplicity, let's pick up to CHECK_LIMIT.
    const toCheck = activeListings
        .sort((a, b) => (a.lastChecked || 0) - (b.lastChecked || 0))
        .slice(0, CONFIG.CHECK_LIMIT);

    console.log(`🔍 Checking ${toCheck.length} listings for availability...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let soldCount = 0;
    for (const listing of toCheck) {
        process.stdout.write(`⏳ Checking [${listing.id}]... `);
        const exists = await checkListing(page, listing.url);

        listing.lastChecked = new Date().getTime();

        if (!exists) {
            console.log('🔴 SOLD');
            listing.isSold = true;
            listing.soldAt = new Date().toISOString();
            soldCount++;

            // Update in scored listings too
            const scoredIdx = scoredListings.findIndex(sl => sl.id === listing.id);
            if (scoredIdx !== -1) {
                scoredListings[scoredIdx].isSold = true;
                scoredListings[scoredIdx].soldAt = listing.soldAt;
            }
        } else {
            console.log('🟢 ACTIVE');
        }

        // Small delay to be nice
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    }

    await browser.close();

    // Save back to files
    fs.writeFileSync(CONFIG.LISTINGS_FILE, JSON.stringify(listings, null, 2));
    if (scoredListings.length > 0) {
        fs.writeFileSync(CONFIG.SCORED_FILE, JSON.stringify(scoredListings, null, 2));
    }

    console.log(`\n✅ Sold Detection Agent - COMPLETED`);
    console.log(`📊 Result: ${soldCount} listings marked as SOLD.`);
}

run();
