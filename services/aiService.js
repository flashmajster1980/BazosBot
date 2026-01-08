const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const API_KEY = process.env.AI_API_KEY;

async function analyzeListingDescription(title, description) {
    if (!API_KEY) {
        console.warn('⚠️ AI Service skipped: Missing AI_API_KEY');
        return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
        Si expert na nákup ojazdených áut. Analyzuj tento inzerát:
        TITULOK: ${title}
        POPIS: ${description}

        Zameraj sa na:
        1. Skryté vady (napr. klepanie, dym, hrdza, "treba vidieť", bez záruky).
        2. Naliehavosť predaja (súri, odchod do zahraničia, finančná tieseň).
        3. Celkový dojem (cukrík vs. pracant).

        Vráť odpoveď striktne ako JSON objekt:
        {
            "verdict": "Krátky verdikt (max 10 slov)",
            "risk_level": (číslo 1-10, kde 10 je extrémne riziko, 1 je bezpečné)
        }
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
            return JSON.parse(cleanedText);
        } catch (e) {
            console.error('❌ AI Parse Error:', e.message);
            // Fallback
            return { verdict: "Nedá sa analyzovať", risk_level: 5 };
        }

    } catch (error) {
        console.error('❌ AI API Error:', error.message);
        return null;
    }
}

module.exports = { analyzeListingDescription };
