const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ========================================
// SUPPORTED MODELS CONFIGURATION
// ========================================
const SUPPORTED_MODELS = {
    'tesla': {
        'model-3': { name: 'Tesla Model 3', defaultYear: 2017 },
        'model-y': { name: 'Tesla Model Y', defaultYear: 2020 },
        'model-s': { name: 'Tesla Model S', defaultYear: 2012 },
        'model-x': { name: 'Tesla Model X', defaultYear: 2015 }
    },
    'volkswagen': {
        'id-3': { name: 'VW ID.3', defaultYear: 2020 },
        'id-4': { name: 'VW ID.4', defaultYear: 2021 },
        'id-5': { name: 'VW ID.5', defaultYear: 2021 }
    }
};

// Parse command line arguments
const args = process.argv.slice(2);
let make = 'tesla';
let model = 'model-3';
let yearFrom = null;
let yearTo = new Date().getFullYear();
let priceFrom = null;
let priceTo = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--make' && args[i + 1]) {
        make = args[i + 1].toLowerCase();
        i++;
    } else if (args[i] === '--model' && args[i + 1]) {
        model = args[i + 1].toLowerCase();
        i++;
    } else if (args[i] === '--year' && args[i + 1]) {
        yearFrom = parseInt(args[i + 1]);
        yearTo = yearFrom;
        i++;
    } else if (args[i] === '--yearfrom' && args[i + 1]) {
        yearFrom = parseInt(args[i + 1]);
        i++;
    } else if (args[i] === '--yearto' && args[i + 1]) {
        yearTo = parseInt(args[i + 1]);
        i++;
    } else if (args[i] === '--pricefrom' && args[i + 1]) {
        priceFrom = parseInt(args[i + 1]);
        i++;
    } else if (args[i] === '--priceto' && args[i + 1]) {
        priceTo = parseInt(args[i + 1]);
        i++;
    }
}

// Validate and get model info
const modelInfo = SUPPORTED_MODELS[make]?.[model];
if (!modelInfo) {
    console.error(`❌ Nepodporovaný model: ${make} ${model}`);
    console.log('\n📋 Podporované modely:');
    Object.entries(SUPPORTED_MODELS).forEach(([makeName, models]) => {
        console.log(`  ${makeName}:`);
        Object.entries(models).forEach(([modelName, info]) => {
            console.log(`    - ${modelName} (${info.name})`);
        });
    });
    console.log('\n💡 Použitie: node scraper.js --make tesla --model model-y --year 2020');
    process.exit(1);
}

// Use default year if not specified
if (!args.includes('--yearfrom') && !args.includes('--year')) {
    yearFrom = modelInfo.defaultYear;
}

console.log(`🎯 Vyhľadávam: ${modelInfo.name} (${yearFrom}-${yearTo}${priceFrom || priceTo ? `, €${priceFrom || 0}-${priceTo || '∞'}` : ''})`);

// Build search URL with filters
let SEARCH_URL = `https://www.autoscout24.de/lst/${make}/${model}?atype=C&cy=D&desc=0&frfrom=${yearFrom}&frtothis=${yearTo}&powertype=kw&sort=price&ustate=N%2CU`;

if (priceFrom) {
    SEARCH_URL += `&pricefrom=${priceFrom}`;
}
if (priceTo) {
    SEARCH_URL += `&priceto=${priceTo}`;
}

async function run() {
    console.log("🚀 Launching Stealth Browser...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log("🌐 Navigating to AutoScout24...");
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Save screenshot for user
    await page.screenshot({ path: 'debug.png' });
    console.log("📸 Screenshot saved to debug.png");

    // Handle Consent (Shadow DOM aware)
    try {
        console.log("🪪 Handling cookies (Checking Shadow DOM)...");
        await page.waitForSelector('#preact-border-shadow-host', { timeout: 10000 }).catch(() => null);

        await page.evaluate(() => {
            const host = document.getElementById('preact-border-shadow-host');
            if (host && host.shadowRoot) {
                const buttons = Array.from(host.shadowRoot.querySelectorAll('button'));
                const accept = buttons.find(b => b.innerText.includes('Alle akzeptieren') || b.innerText.includes('Accept'));
                if (accept) {
                    accept.click();
                    return;
                }
            }
            // Fallback to regular DOM
            const buttons = Array.from(document.querySelectorAll('button'));
            const acceptButton = buttons.find(b => b.textContent.includes('Alle akzeptieren') || b.textContent.includes('Accept'));
            if (acceptButton) acceptButton.click();
        });

        await new Promise(r => setTimeout(r, 3000));
        await page.screenshot({ path: 'debug_after_cookie.png' });
    } catch (e) {
        console.log("ℹ️ Cookie banner issue:", e.message);
    }

    console.log("📍 Extracting listings...");

    const cars = await page.evaluate(() => {
        // Use the reliable data-testid selector found by browser inspection
        const items = Array.from(document.querySelectorAll('article[data-testid="decluttered-list-item"]'));
        const results = [];

        items.forEach(item => {
            try {
                // Use data-* attributes - much more reliable than CSS classes
                const price = parseInt(item.getAttribute('data-price') || '0');
                const mileage = parseInt(item.getAttribute('data-mileage') || '0');
                const firstReg = item.getAttribute('data-first-registration') || '';
                const guid = item.getAttribute('data-guid') || '';
                const make = item.getAttribute('data-make') || '';
                const model = item.getAttribute('data-model') || '';

                // Extract year from first registration (format: "MM-YYYY" or "MM/YYYY")
                let year = 2021;
                const regMatch = firstReg.match(/(\d{2})[-\/](\d{4})/);
                if (regMatch) {
                    year = parseInt(regMatch[2]);
                }

                // Title from h2
                const titleElem = item.querySelector('h2');
                const title = titleElem ? titleElem.innerText.trim() : `${make} ${model}`.trim() || "Tesla Model 3";

                // Link - construct from guid or find anchor
                let link = '';
                const anchor = item.querySelector('a[href*="/angebote/"]');
                if (anchor) {
                    link = anchor.href;
                } else if (guid) {
                    link = `https://www.autoscout24.de/angebote/${guid}`;
                }

                // Check if private seller (often in text)
                const text = item.innerText;
                const isPrivate = text.toLowerCase().includes('privat');

                // EQUIPMENT DETECTION from title
                const titleLower = title.toLowerCase();

                // Variant detection
                let variant = 'Standard Range';
                if (titleLower.includes('long range') || titleLower.includes('lr')) {
                    variant = titleLower.includes('awd') || titleLower.includes('dual motor') ? 'Long Range AWD' : 'Long Range';
                } else if (titleLower.includes('performance')) {
                    variant = 'Performance';
                } else if (titleLower.includes('standard range plus') || titleLower.includes('sr+')) {
                    variant = 'Standard Range Plus';
                }

                // Battery size extraction (e.g., "75kWh", "60 kWh")
                let battery_kwh = null;
                const batteryMatch = title.match(/(\d{2,3})\s?kWh/i);
                if (batteryMatch) {
                    battery_kwh = parseInt(batteryMatch[1]);
                } else {
                    // Estimate based on variant
                    if (variant.includes('Long Range')) battery_kwh = 75;
                    else if (variant.includes('Standard Range')) battery_kwh = 55;
                }

                // Heat pump detection
                const has_heat_pump = titleLower.includes('wärmepumpe') ||
                    titleLower.includes('heat pump') ||
                    titleLower.includes('wp') ||
                    year >= 2021; // 2021+ refresh models usually have it

                // Fast charging detection (CCS is standard on Tesla, assume true unless noted)
                const has_fast_charging = !titleLower.includes('no ccs') &&
                    !titleLower.includes('ohne ccs');

                // Filter: price > 5000 and has link
                if (price > 5000 && link) {
                    results.push({
                        title,
                        price,
                        km: mileage,
                        year,
                        variant,
                        battery_kwh,
                        has_heat_pump,
                        has_fast_charging,
                        is_private: isPrivate,
                        link,
                        first_registration: firstReg,
                        market: 'DE'  // German market identifier
                    });
                }
            } catch (e) {
                console.error('Error extracting item:', e.message);
            }
        });
        return results;
    });

    console.log(`✅ Found ${cars.length} candidates.`);
    if (cars.length > 0) {
        cars.sort((a, b) => a.price - b.price);
        fs.writeFileSync(path.join(__dirname, 'scraped_data.json'), JSON.stringify(cars.slice(0, 5), null, 2));
        console.log("💽 Results saved to scraped_data.json");
    } else {
        console.log("⚠️ No cars found. Content might be blocked or selectors changed.");
    }

    await browser.close();
}

run();
