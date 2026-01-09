const NormalizationService = require('./services/normalizationService');

const testCases = [
    {
        name: "BMW X5 Missing Trans/Drive",
        input: { title: "BMW X5 3.0d", description: "Top stav", model: "X5", fuel: "Diesel", transmission: null, drive: null },
        expected: { transmission: "Automat", drive: "4x4" } // Auto-inferred for Premium SUV
    },
    {
        name: "Peugeot Rifter HDi (False EV check)",
        input: { title: "Peugeot Rifter 1.5 HDi", description: "Lokace: Levice", fuel: "Elektro" },
        expected: { fuel: "Diesel" } // Should be corrected
    },
    {
        name: "VW ID.3 (True EV)",
        input: { title: "Volkswagen ID.3 Pro", description: "Electric", fuel: null },
        expected: { fuel: "Elektro" }
    },
    {
        name: "Skoda Octavia TDI (Missing Fuel)",
        input: { title: "Skoda Octavia 2.0 TDI", description: "", fuel: null },
        expected: { fuel: "Diesel" }
    },
    {
        name: "BMW 330i (Missing Fuel)",
        input: { title: "BMW 330i M-Packet", description: "", fuel: null },
        expected: { fuel: "Benzín" }
    },
    {
        name: "KM Inference (150tis)",
        input: { title: "Predam Auto 150tis km", km: null },
        expected: { km: 150000 }
    },
    {
        name: "Karoq False Automatic (Regression)",
        input: { title: "Skoda Karoq 1.5 TSI", description: "TRAVEL ASSIST – automatická jazda v pruhu, automatická klimatizácia", transmission: null },
        expected: { transmission: null } // Should NOT be 'Automat'
    },
    {
        name: "KM Inference (Spaces)",
        input: { title: "Auto 220 000 km top stav", km: 0 },
        expected: { km: 220000 }
    },
    {
        name: "KM in Description (New Feature)",
        input: { title: "Predam BMW X5", description: "Najazdené: 185 000 km.", km: null },
        expected: { km: 185000 }
    },
    {
        name: "X5 Weird KM (Regression)",
        input: { title: "BMW X5", description: "Najazdené: 200000– Kilometre poctivo", km: null },
        expected: { km: 200000 }
    },
    {
        name: "Octavia Prefix KM",
        input: { title: "Octavia", description: "Najazdených km: 303000\nPrevodovka: Manuál", km: null },
        expected: { km: 303000 }
    },
    {
        name: "BMW 3.0d Fuel",
        input: { title: "BMW X5", description: "Motor: 3.0d / 195kw", fuel: null },
        expected: { fuel: 'Diesel' }
    }
];

console.log("🧪 Running Normalization Tests...\n");
let passed = 0;
let failed = 0;

testCases.forEach(test => {
    const inputCopy = { ...test.input }; // Copy to avoid mutation affecting log
    const result = NormalizationService.normalizeListing(inputCopy);

    let allMatch = true;
    for (const key in test.expected) {
        if (result[key] !== test.expected[key]) {
            console.error(`❌ ${test.name} FAILED: Expected ${key}=${test.expected[key]}, got ${result[key]}`);
            allMatch = false;
        }
    }

    if (allMatch) {
        console.log(`✅ ${test.name} PASSED`);
        passed++;
    } else {
        failed++;
    }
});

console.log(`\nResults: ${passed} Passed, ${failed} Failed`);
if (failed > 0) process.exit(1);
