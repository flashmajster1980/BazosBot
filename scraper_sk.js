const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
let searchQuery = 'Tesla Model 3';
let yearFrom = 2017;
let yearTo = 2024;
let priceFrom = null;
let priceTo = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--search' && args[i + 1]) {
        searchQuery = args[i + 1];
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

console.log(`🎯 Vyhľadávam na Bazos.sk: "${searchQuery}" (${yearFrom}-${yearTo}${priceFrom || priceTo ? `, €${priceFrom || 0}-${priceTo || '∞'}` : ''})`);

// Build search URL for bazos.sk (NEW URL FORMAT!)
let SEARCH_URL = `https://auto.bazos.sk/?hledat=${encodeURIComponent(searchQuery)}`;

if (priceFrom) {
    SEARCH_URL += `&cenaod=${priceFrom}`;
}
if (priceTo) {
    SEARCH_URL += `&cenado=${priceTo}`;
}

async function run() {
    console.log("🚀 Launching Stealth Browser...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log("🌐 Navigating to Bazos.sk...");
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Save screenshot for debugging
    await page.screenshot({ path: 'debug_sk.png' });
    console.log("📸 Screenshot saved to debug_sk.png");

    // Wait for listings to load
    try {
        await page.waitForSelector('.inzeraty', { timeout: 10000 });
    } catch (e) {
        console.log("⚠️ No listings found on page");
    }

    console.log("📍 Extracting listings from Bazos.sk...");

    const cars = await page.evaluate((yearFrom, yearTo) => {
        // Use the NEW div-based selectors (Bazos.sk changed layout)
        let items = Array.from(document.querySelectorAll('div.inzeraty'));

        console.log('Found elements:', items.length);
        const results = [];

        items.forEach(item => {
            try {
                // Extract title - NEW SELECTOR: h2.nadpis instead of .nadpis a
                const titleElem = item.querySelector('h2.nadpis a') || item.querySelector('.inzeratynadpis a');
                if (!titleElem) return;
                const title = titleElem.innerText.trim();

                // Extract link
                const link = titleElem.href.startsWith('http') ? titleElem.href : 'https://auto.bazos.sk' + titleElem.getAttribute('href');

                // Extract price - NEW SELECTOR: div.inzeratycena (no <b> tag)
                const priceElem = item.querySelector('div.inzeratycena');
                if (!priceElem) return;
                const priceText = priceElem.innerText.replace(/\s/g, '').replace('€', '').replace(/\D/g, '');
                const price = parseInt(priceText);
                if (!price || price < 1000) return;

                // Extract description
                const descElem = item.querySelector('div.popis');
                const fullText = descElem ? descElem.innerText : '';
                const combinedText = title + ' ' + fullText;

                // Try to extract year
                let year = null;
                const yearMatches = [
                    combinedText.match(/rok?\s*(\d{4})/i),
                    combinedText.match(/r\.?v\.?\s*(\d{4})/i),
                    combinedText.match(/\b(20\d{2})\b/),
                    combinedText.match(/(\d{4})\s*$/m) // Year at end of line
                ];

                for (const match of yearMatches) {
                    if (match) {
                        const y = parseInt(match[1]);
                        if (y >= 2015 && y <= 2026) {
                            year = y;
                            break;
                        }
                    }
                }

                // Filter by year range
                if (year && (year < yearFrom || year > yearTo)) {
                    return;
                }

                // Try to extract km
                let km = null;
                const kmMatches = [
                    combinedText.match(/(?:najazdené|nájazd|najazd)[\s:]*(\d[\d\s.]*)(\s*)km/i),
                    combinedText.match(/(?:najazdené|nájazd|najazd)[\söm]*[\s:]*(\d[\d\s.]*)/i),
                    combinedText.match(/(\d[\d\s.]*)\s*(?:tis\.|tisíc)\s*km/i),
                    combinedText.match(/(\d{4,6})\s*km/i),
                    combinedText.match(/(\d[\d\s.]+)\s*km/i)
                ];

                for (const match of kmMatches) {
                    if (match) {
                        // Remove spaces and dots from number
                        let kmValue = parseInt(match[1].replace(/[\s.]/g, ''));

                        // Handle "tis. km" or "tisíc km" (thousands)
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

                // Variant detection
                let variant = 'Standard Range';
                const titleLower = title.toLowerCase();
                if (titleLower.includes('long range') || titleLower.includes(' lr ')) {
                    variant = titleLower.includes('awd') || titleLower.includes('dual motor') ? 'Long Range AWD' : 'Long Range';
                } else if (titleLower.includes('performance')) {
                    variant = 'Performance';
                } else if (titleLower.includes('standard range plus') || titleLower.includes('sr+')) {
                    variant = 'Standard Range Plus';
                }

                // Battery detection
                let battery_kwh = null;
                const batteryMatch = combinedText.match(/(\d{2,3})\s?kWh/i);
                if (batteryMatch) {
                    battery_kwh = parseInt(batteryMatch[1]);
                }

                // Equipment detection
                const has_heat_pump = titleLower.includes('tepelné čerpadlo') ||
                    titleLower.includes('tepelne cerpadlo') ||
                    fullText.toLowerCase().includes('tepelné čerpadlo') ||
                    titleLower.includes('wärmepumpe') ||
                    titleLower.includes('heat pump') ||
                    (year && year >= 2021);

                const has_fast_charging = !titleLower.includes('bez ccs') && !titleLower.includes('no ccs');

                // Only include if we have price
                results.push({
                    title,
                    price,
                    km: km || 0,
                    year: year || new Date().getFullYear(),
                    variant,
                    battery_kwh,
                    has_heat_pump,
                    has_fast_charging,
                    is_private: true,
                    link,
                    first_registration: year ? `01-${year}` : '',
                    market: 'SK'  // Slovak market identifier
                });
            } catch (e) {
                console.error('Error extracting item:', e.message);
            }
        });
        return results;
    }, yearFrom, yearTo);

    console.log(`✅ Found ${cars.length} candidates on Bazos.sk.`);

    if (cars.length > 0) {
        cars.sort((a, b) => a.price - b.price);
        fs.writeFileSync(path.join(__dirname, 'scraped_data.json'), JSON.stringify(cars, null, 2));
        console.log("💽 Results saved to scraped_data.json");
    } else {
        console.log("⚠️ No cars found on Bazos.sk.");
    }

    await browser.close();
}

run();
