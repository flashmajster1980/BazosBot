const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { dbAsync } = require('./database');
const axios = require('axios');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

async function enrichBazos(page, listing) {
    console.log(`🔍 [Enriching Bazos] ${listing.title} | ${listing.url}`);
    try {
        await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const table = document.querySelector('table.listatabulka');

            return {
                km: bodyText.match(/(\d+[\s.]*)\s*(?:km|tis\.)/i)?.[0],
                year: bodyText.match(/\b(20\d{2})\b/)?.[1],
                location: document.querySelector('.vypis .listalok')?.innerText.trim(),
                seller_name: document.querySelector('.vypis .listameno a')?.innerText.trim(),
                seller_type: document.body.innerText.includes('Podnikateľ') ? '🏢 Bazár / Predajca' : '👤 Súkromná osoba'
            };
        });

        let parsedKm = listing.km;
        if (data.km) {
            const kmVal = parseInt(data.km.replace(/\D/g, ''));
            parsedKm = data.km.toLowerCase().includes('tis') ? kmVal * 1000 : kmVal;
        }

        await dbAsync.run(
            `UPDATE listings SET 
                year = COALESCE(year, ?), 
                km = COALESCE(km, ?), 
                location = COALESCE(?, location), 
                seller_name = COALESCE(seller_name, ?),
                seller_type = ?
            WHERE id = ?`,
            [data.year ? parseInt(data.year) : null, parsedKm, data.location, data.seller_name, data.seller_type, listing.id]
        );
        console.log(`   ✅ OK: [${listing.id}] ${data.location || '?'}, ${parsedKm || '?'} km`);
    } catch (e) {
        console.error(`   ❌ Failed: ${e.message}`);
    }
}

async function enrichAutobazarSK(page, listing) {
    console.log(`🔍 [Enriching Autobazar.sk] ${listing.title} | ${listing.url}`);
    try {
        await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const data = await page.evaluate(() => {
            const locElem = document.querySelector('.location-box, .contact-location, [class*="Location"]');
            const sellerName = document.querySelector('.seller-name, [class*="SellerName"]')?.innerText.trim();
            const bodyText = document.body.innerText;

            return {
                location: locElem ? locElem.innerText.trim() : null,
                seller_name: sellerName,
                seller_type: document.querySelector('.ico-user') ? '👤 Súkromná osoba' : '🏢 Bazár / Predajca',
                year: bodyText.match(/Rok výroby:\s*(\d{4})/)?.[1],
                km: bodyText.match(/Najazdené km:\s*([\d\s]+)/)?.[1]
            };
        });

        await dbAsync.run(
            `UPDATE listings SET 
                location = COALESCE(?, location), 
                seller_name = COALESCE(seller_name, ?),
                seller_type = ?,
                year = COALESCE(year, ?),
                km = COALESCE(km, ?)
            WHERE id = ?`,
            [data.location, data.seller_name, data.seller_type, data.year ? parseInt(data.year) : null, data.km ? parseInt(data.km.replace(/\s/g, '')) : null, listing.id]
        );
        console.log(`   ✅ OK: [${listing.id}] ${data.location || '?'}, ${data.km || '?'} km`);
    } catch (e) {
        console.error(`   ❌ Failed: ${e.message}`);
    }
}

async function enrichAutobazarEU(page, listing) {
    console.log(`🔍 [Enriching Autobazar.eu] ${listing.title} | ${listing.url}`);
    try {
        await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const locElem = document.querySelector('.location, .contact-info, [class*="Location"]');
            const sellerName = document.querySelector('.seller-name, [class*="SellerName"]')?.innerText.trim();
            const isPrivate = document.body.innerText.includes('Súkromný predajca') || !!document.querySelector('.ico-user');

            return {
                year: bodyText.match(/Rok výroby:\s*(\d{4})/)?.[1],
                km: bodyText.match(/Najazdené km:\s*([\d\s]+)/)?.[1],
                location: locElem ? locElem.innerText.split('\n')[0].trim() : null,
                seller_name: sellerName,
                seller_type: isPrivate ? '👤 Súkromná osoba' : '🏢 Bazár / Predajca'
            };
        });

        await dbAsync.run(
            `UPDATE listings SET 
                year = COALESCE(year, ?), 
                km = COALESCE(km, ?), 
                location = COALESCE(?, location), 
                seller_name = COALESCE(seller_name, ?),
                seller_type = ?
            WHERE id = ?`,
            [data.year ? parseInt(data.year) : null, data.km ? parseInt(data.km.replace(/\s/g, '')) : null, data.location, data.seller_name, data.seller_type, listing.id]
        );
        console.log(`   ✅ OK: [${listing.id}] ${data.location || '?'}`);
    } catch (e) {
        console.error(`   ❌ Failed: ${e.message}`);
    }
}

async function run() {
    console.log('🚀 Enrichment Agent - STARTED');

    const incomplete = await dbAsync.all(`
        SELECT * FROM listings 
        WHERE (location IS NULL OR location LIKE '%kraj%' OR year IS NULL OR km IS NULL OR km = 0 OR seller_type IS NULL)
        AND is_sold = 0
        AND scraped_at > datetime('now', '-24 hours')
        LIMIT 200
    `);

    console.log(`Found ${incomplete.length} incomplete listings to enrich.`);
    if (incomplete.length === 0) { console.log('Nothing to do.'); process.exit(0); }

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const listing of incomplete) {
        if (listing.portal === 'Bazos') await enrichBazos(page, listing);
        else if (listing.portal === 'Autobazar.sk') await enrichAutobazarSK(page, listing);
        else if (listing.portal === 'Autobazar.eu') await enrichAutobazarEU(page, listing);

        // Random human-like delay
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
    }

    await browser.close();
    console.log('✅ Enrichment Agent - COMPLETED');
    process.exit(0);
}

run();
