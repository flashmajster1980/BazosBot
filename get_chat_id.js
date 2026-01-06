// Helper script to get your Telegram Chat ID
// Usage: node get_chat_id.js YOUR_BOT_TOKEN

const axios = require('axios');

const botToken = process.argv[2];

if (!botToken) {
    console.log('❌ Usage: node get_chat_id.js YOUR_BOT_TOKEN');
    console.log('\nExample:');
    console.log('  node get_chat_id.js 123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    process.exit(1);
}

async function getChatId() {
    console.log('🔍 Fetching updates from Telegram...\n');

    try {
        const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
        const response = await axios.get(url);

        if (!response.data.ok) {
            console.error('❌ Telegram API error:', response.data);
            return;
        }

        const updates = response.data.result;

        if (updates.length === 0) {
            console.log('⚠️  No messages found!');
            console.log('\n📝 Please do the following:');
            console.log('  1. Open Telegram and search for your bot');
            console.log('  2. Click "START" or send any message');
            console.log('  3. Run this script again\n');
            return;
        }

        console.log(`✅ Found ${updates.length} update(s)!\n`);

        // Get the most recent chat ID
        const latestUpdate = updates[updates.length - 1];
        const chatId = latestUpdate.message?.chat?.id;
        const username = latestUpdate.message?.chat?.username;
        const firstName = latestUpdate.message?.chat?.first_name;

        if (!chatId) {
            console.log('❌ Could not extract Chat ID from updates');
            console.log('Raw data:', JSON.stringify(updates, null, 2));
            return;
        }

        console.log('🎉 SUCCESS!\n');
        console.log('Your Telegram Chat ID:', chatId);
        if (username) console.log('Username:', username);
        if (firstName) console.log('Name:', firstName);

        console.log('\n📋 Add this to your .env file:');
        console.log(`TELEGRAM_CHAT_ID=${chatId}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('API Response:', error.response.data);
        }
    }
}

getChatId();
