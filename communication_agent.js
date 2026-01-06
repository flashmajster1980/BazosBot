require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCORED_LISTINGS_FILE: path.join(__dirname, 'scored_listings.json'),
    NOTIFIED_IDS_FILE: path.join(__dirname, 'notified_deals.json'),
};

// ========================================
// HELPER FUNCTIONS
// ========================================

function loadNotifiedIds() {
    if (fs.existsSync(CONFIG.NOTIFIED_IDS_FILE)) {
        const data = fs.readFileSync(CONFIG.NOTIFIED_IDS_FILE, 'utf-8');
        return new Set(JSON.parse(data));
    }
    return new Set();
}

function saveNotifiedIds(ids) {
    fs.writeFileSync(CONFIG.NOTIFIED_IDS_FILE, JSON.stringify([...ids], null, 2));
}

function extractLocation(url, title) {
    // Try to extract location from URL
    const urlMatch = url.match(/\/([a-z-]+)\/inzerat\//i);
    if (urlMatch && urlMatch[1] && urlMatch[1] !== 'auto') {
        const location = urlMatch[1].charAt(0).toUpperCase() + urlMatch[1].slice(1);
        return location;
    }

    // Common Slovak cities
    const cities = ['Bratislava', 'Košice', 'Prešov', 'Žilina', 'Banská Bystrica', 'Nitra', 'Trnava', 'Martin', 'Trenčín'];
    const titleLower = title.toLowerCase();

    for (const city of cities) {
        if (titleLower.includes(city.toLowerCase())) {
            return city;
        }
    }

    return 'Slovensko';
}

function formatMessage(deal) {
    const location = extractLocation(deal.url, deal.title);
    const savings = deal.medianPrice - deal.price;
    const date = new Date().toLocaleDateString('sk-SK');

    return `🌟 *GOLDEN DEAL!* -${deal.discount}%

🚗 *${deal.make} ${deal.model}* (${deal.year})
💰 Cena: €${deal.price.toLocaleString()}
📊 Medián: €${deal.medianPrice.toLocaleString()}
💸 Zľava: -${deal.discount}% (€${savings.toLocaleString()})
📍 Lokalita: ${location}
🔗 [Zobraziť inzerát](${deal.url})

⏰ Nájdené: ${date}`;
}

async function sendTelegramMessage(message, testMode = false) {
    if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
        console.error('❌ Telegram credentials not configured!');
        console.log('💡 Create .env file with:');
        console.log('   TELEGRAM_BOT_TOKEN=your_bot_token');
        console.log('   TELEGRAM_CHAT_ID=your_chat_id');
        return false;
    }

    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        const response = await axios.post(url, {
            chat_id: CONFIG.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
            disable_web_page_preview: false
        });

        if (response.data.ok) {
            console.log('✅ Telegram message sent successfully!');
            return true;
        } else {
            console.error('❌ Telegram API error:', response.data);
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to send Telegram message:', error.message);
        if (error.response) {
            console.error('   API Response:', error.response.data);
        }
        return false;
    }
}

// ========================================
// MAIN FUNCTION
// ========================================

async function run(testMode = false) {
    console.log('🤖 Communication Agent - STARTED\n');

    // Test mode
    if (testMode) {
        console.log('🧪 Test mode: Sending test message...\n');
        const testMessage = `🧪 *BazosBot Test*

Telegram integration is working! ✅

This is a test message from Communication Agent.`;

        const success = await sendTelegramMessage(testMessage, true);
        if (success) {
            console.log('\n✅ Test completed successfully!');
        } else {
            console.log('\n❌ Test failed. Check your credentials.');
        }
        return;
    }

    // Load scored listings
    if (!fs.existsSync(CONFIG.SCORED_LISTINGS_FILE)) {
        console.error(`❌ Scored listings file not found: ${CONFIG.SCORED_LISTINGS_FILE}`);
        console.log('💡 Run scoring_agent.js first to generate scored listings.');
        process.exit(1);
    }

    const scoredData = fs.readFileSync(CONFIG.SCORED_LISTINGS_FILE, 'utf-8');
    const scoredListings = JSON.parse(scoredData);

    console.log(`📁 Loaded ${scoredListings.length} scored listings\n`);

    // Load notified IDs
    const notifiedIds = loadNotifiedIds();
    console.log(`📋 Already notified: ${notifiedIds.size} deals\n`);

    // Find GOLDEN DEALs that haven't been notified yet
    const goldenDeals = scoredListings.filter(listing =>
        listing.dealType === 'GOLDEN DEAL' &&
        !listing.isFiltered &&
        !notifiedIds.has(listing.id)
    );

    if (goldenDeals.length === 0) {
        console.log('ℹ️  No new GOLDEN DEALs to notify.');
        console.log('✅ Communication Agent - COMPLETED');
        return;
    }

    console.log(`🌟 Found ${goldenDeals.length} new GOLDEN DEAL(s) to notify!\n`);

    // Send notifications
    let successCount = 0;

    for (const deal of goldenDeals) {
        console.log(`📱 Sending notification for: ${deal.make} ${deal.model} (${deal.year})`);
        console.log(`   Price: €${deal.price.toLocaleString()} | Discount: ${deal.discount}%`);

        const message = formatMessage(deal);
        const success = await sendTelegramMessage(message);

        if (success) {
            notifiedIds.add(deal.id);
            successCount++;
            console.log(`   ✅ Notified!\n`);
        } else {
            console.log(`   ❌ Failed to send\n`);
        }

        // Small delay between messages
        if (goldenDeals.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Save updated notified IDs
    if (successCount > 0) {
        saveNotifiedIds(notifiedIds);
        console.log(`💾 Saved ${successCount} notified ID(s)`);
    }

    console.log(`\n📊 Summary:`);
    console.log(`  - New GOLDEN DEALs: ${goldenDeals.length}`);
    console.log(`  - Successfully notified: ${successCount}`);
    console.log(`  - Total notified ever: ${notifiedIds.size}`);

    console.log('\n✅ Communication Agent - COMPLETED');
}

// Parse command line arguments
const args = process.argv.slice(2);
const testMode = args.includes('--test');

// Run the agent
run(testMode).catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
