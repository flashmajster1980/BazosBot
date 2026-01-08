const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const API_KEY = process.env.AI_API_KEY;

async function inspectListing(listing) {
    if (!API_KEY) {
        console.warn('⚠️ AI Inspector skipped: Missing AI_API_KEY in .env');
        return null;
    }

    // Only inspect promising deals to save costs
    if ((listing.deal_score || 0) <= 15) {
        return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
        Analyzuj tento inzerát na auto.
        Titulok: ${listing.title}
        Popis: ${listing.description}
        Cena: ${listing.price} EUR
        Ročník: ${listing.year}
        KM: ${listing.km}

        Tvoja úloha:
        1. Hľadaj skryté vady, náznaky problémov (napr. "po repase", "klepe", "dymí", "bez záruky", "dovoz", "búrané").
        2. Odhadni dôvod predaja a mieru naliehavosti (napr. sťahovanie, finančná tieseň, nové auto).
        
        Výstup vráť striktne ako čistý JSON objekt (bez markdown formátovania, bez \`\`\`json):
        {
            "verdict": "Krátky verdikt max 15 slov po slovensky",
            "trust_score": (číslo 1-10, kde 10 je absolútne dôveryhodné),
            "hidden_risks": ["zoznam", "rizík"]
        }
        `;

        console.log(`🧠 Gemini Inspector analysing: ${listing.title}...`);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Clean up markdown if Gemini adds it despite instructions
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
            return JSON.parse(cleanedText);
        } catch (e) {
            console.error('❌ Gemini JSON Parse Error:', e.message);
            // Fallback for messy response
            return { verdict: "Chyba formátu AI odpovede", trust_score: 5, hidden_risks: [] };
        }

    } catch (error) {
        console.error('❌ Gemini API Error:', error.message);
        return null;
    }
}

module.exports = { inspectListing };
