const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { dbAsync } = require('./database');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function cleanStr(str) {
    return str ? str.replace(/\s+/g, ' ').trim() : '';
}

async function extractBazos(page) {
    return page.evaluate(() => {
        const body = document.body.innerText;
        const title = document.querySelector('h1.nadpis')?.innerText.trim();
        const priceText = document.querySelector('.listavypis.cena b')?.innerText.trim();
        const locText = document.querySelector('.vypis .listalok')?.innerText.trim();
        const kmMatch = body.match(/(\d+[\s.]*)\s*(?:km|tis\.)/i);
        const yearMatch = body.match(/\b(20\d{2})\b/);

        return {
            title: title,
            price: priceText ? parseFloat(priceText.replace(/\D/g, '')) : null,
            location: locText,
            km: kmMatch ? parseFloat(kmMatch[1].replace(/\D/g, '')) : null,
            kmRaw: kmMatch ? kmMatch[0] : null,
            year: yearMatch ? parseInt(yearMatch[1]) : null
        };
    });
}

async function extractAutobazarSK(page) {
    return page.evaluate(() => {
        const title = document.querySelector('h1')?.innerText.trim();
        const priceElem = document.querySelector('.price-box__price, .b-detail-price__value');
        const price = priceElem ? parseFloat(priceElem.innerText.replace(/\D/g, '')) : null;
        const locElem = document.querySelector('.location-box, .contact-location, [class*="Location"]');
        const bodyText = document.body.innerText;
        const kmMatch = bodyText.match(/Najazdené km:\s*([\d\s]+)/);
        const yearMatch = bodyText.match(/Rok výroby:\s*(\d{4})/);

        return {
            title,
            price,
            location: locElem ? locElem.innerText.trim() : null,
            km: kmMatch ? parseFloat(kmMatch[1].replace(/\D/g, '')) : null,
            year: yearMatch ? parseInt(yearMatch[1]) : null
        };
    });
}

async function extractAutobazarEU(page) {
    return page.evaluate(() => {
        const title = document.querySelector('h1')?.innerText.trim();
        const priceElem = document.querySelector('.price-main, .price');
        const price = priceElem ? parseFloat(priceElem.innerText.replace(/\D/g, '')) : null;
        const locElem = document.querySelector('.location, .contact-info');
        const bodyText = document.body.innerText;
        const kmMatch = bodyText.match(/Najazdené km:\s*([\d\s]+)/);
        const yearMatch = bodyText.match(/Rok výroby:\s*(\d{4})/);

        return {
            title,
            price,
            location: locElem ? locElem.innerText.split('\n')[0].trim() : null,
            km: kmMatch ? parseFloat(kmMatch[1].replace(/\D/g, '')) : null,
            year: yearMatch ? parseInt(yearMatch[1]) : null
        };
    });
}

async function runCheck() {
    console.log('🕵️ Integrity Check - STARTED');

    // Select 20 random listings
    const listings = await dbAsync.all("SELECT * FROM listings WHERE is_sold = 0 ORDER BY RANDOM() LIMIT 20");
    console.log(`Checking ${listings.length} listings against live web data...\n`);

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let errors = 0;
    let verified = 0;

    console.log('| ID | Portal | Attr | DB Value | Web Value | Status |');
    console.log('|---|---|---|---|---|---|');

    for (const l of listings) {
        try {
            await page.goto(l.url, { waitUntil: 'domcontentloaded', timeout: 20000 });

            let data = null;
            if (l.portal === 'Bazos') data = await extractBazos(page);
            else if (l.portal === 'Autobazar.sk') data = await extractAutobazarSK(page);
            else if (l.portal === 'Autobazar.eu') data = await extractAutobazarEU(page);

            if (!data) {
                console.log(`| ${l.id} | ${l.portal} | LOAD | - | - | ❌ Failed to extract |`);
                continue;
            }

            // CHECK PRICE
            if (data.price && Math.abs(data.price - l.price) > 5) {
                console.log(`| ${l.id} | ${l.portal} | PRICE | ${l.price} | ${data.price} | ⚠️ MISMATCH |`);
                errors++;
            }

            // CHECK KM (Allow 1000km drift due to rounding "tis.")
            // Bazos uses "150 tis. km", so DB has 150000. Web match might return 150000.
            if (data.km) {
                // Determine precision. If Bazos says 150, it means 150000. 
                // Database might update to exact if enrichment ran?
                // Visual check is best here.
                const diff = Math.abs((l.km || 0) - data.km);
                if (diff > 2000) { // Tolerance 2000 km
                    console.log(`| ${l.id} | ${l.portal} | KM | ${l.km} | ${data.km} | ⚠️ MISMATCH |`);
                    errors++;
                }
            }

            // CHECK YEAR
            if (data.year && l.year !== data.year) {
                console.log(`| ${l.id} | ${l.portal} | YEAR | ${l.year} | ${data.year} | ⚠️ MISMATCH |`);
                errors++;
            }

            // CHECK LOCATION (Fuzzy)
            if (data.location && l.location && !l.location.includes(data.location) && !data.location.includes(l.location)) {
                console.log(`| ${l.id} | ${l.portal} | LOC | ${l.location} | ${data.location} | ⚠️ MISMATCH |`);
                errors++;
            }

            verified++;
            // process.stdout.write('.');

        } catch (e) {
            console.log(`| ${l.id} | ${l.portal} | ERROR | - | - | ❌ ${e.message.slice(0, 30)}... |`);
        }

        // Random delay
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n\n✅ Check complete.`);
    console.log(`Verified: ${verified}/${listings.length}`);
    console.log(`Discrepancies found: ${errors}`);

    await browser.close();
}

runCheck();
