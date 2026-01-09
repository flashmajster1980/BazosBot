const BRAND_ALIASES = {
    'vw': 'Volkswagen', 'škoda': 'Škoda', 'skoda': 'Škoda',
    'mercedes-benz': 'Mercedes-Benz', 'mercedes': 'Mercedes-Benz',
    'bmw': 'BMW', 'audi': 'Audi', 'seat': 'Seat', 'tesla': 'Tesla',
    'hyundai': 'Hyundai', 'ford': 'Ford', 'opel': 'Opel',
    'peugeot': 'Peugeot', 'renault': 'Renault', 'toyota': 'Toyota',
    'honda': 'Honda', 'mazda': 'Mazda', 'nissan': 'Nissan',
    'kia': 'Kia', 'volvo': 'Volvo', 'fiat': 'Fiat',
};

const KNOWN_MODELS = {
    'Volkswagen': ['Golf', 'Passat', 'Tiguan', 'Polo', 'T-Roc', 'T-Cross', 'Touareg', 'Arteon', 'Caddy', 'Transporter', 'ID.3', 'ID.4', 'ID.5'],
    'Škoda': ['Octavia', 'Fabia', 'Superb', 'Kodiaq', 'Karoq', 'Kamiq', 'Scala', 'Rapid', 'Enyaq'],
    'BMW': ['Series', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4', 'i3', 'i4', 'iX'],
    'Audi': ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q4', 'Q5', 'Q7', 'Q8', 'TT', 'e-tron'],
    'Tesla': ['Model S', 'Model 3', 'Model X', 'Model Y'],
};

function extractMakeModel(title) {
    const titleLower = title.toLowerCase();
    let make = null;
    let model = null;

    // 1. Identify Make
    for (const [alias, fullName] of Object.entries(BRAND_ALIASES)) {
        if (titleLower.startsWith(alias + ' ') || titleLower.includes(' ' + alias + ' ')) {
            make = fullName;
            break;
        }
    }

    if (!make) {
        const firstWord = title.split(' ')[0];
        if (firstWord && firstWord.length > 2) {
            const candidate = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
            const normalized = BRAND_ALIASES[firstWord.toLowerCase()];
            if (normalized) make = normalized;
            else if (['Volkswagen', 'Škoda', 'BMW', 'Audi', 'Mercedes-Benz', 'Seat', 'Ford', 'Tesla', 'Hyundai', 'Kia', 'Toyota', 'Honda', 'Mazda', 'Nissan', 'Volvo', 'Fiat', 'Peugeot', 'Renault', 'Opel', 'Citroen', 'Dacia'].includes(candidate)) {
                make = candidate;
            }
        }
    }

    if (make) {
        // --- BMW SPECIAL HANDLING ---
        if (make === 'BMW') {
            const seriesMatch = titleLower.match(/\b(rad|series)\s?(\d)\b/);
            const tourerMatch = titleLower.match(/\b(gran|active)\s?tourer\b/);
            const xMatch = titleLower.match(/\b(x[1-7])\b/i);
            const iMatch = titleLower.match(/\b(i[384x]|[a-z]3)\b/i);
            const zMatch = titleLower.match(/\b(z[34])\b/i);

            if (seriesMatch) {
                model = `Rad ${seriesMatch[2]}`;
                if (tourerMatch) model += ' ' + (tourerMatch[1] === 'gran' ? 'Gran' : 'Active') + ' Tourer';
            } else if (tourerMatch) {
                model = `Rad 2 ${tourerMatch[1] === 'gran' ? 'Gran' : 'Active'} Tourer`;
            } else if (xMatch) {
                model = xMatch[1].toUpperCase();
            } else if (iMatch) {
                model = iMatch[1].toLowerCase(); // e.g. i3
            } else if (zMatch) {
                model = zMatch[1].toUpperCase();
            }
        }

        // --- STANDARD MODEL LOOKUP ---
        if (!model && KNOWN_MODELS[make]) {
            // Sort by length desc to match "Grand Santa Fe" before "Santa Fe"
            const sortedModels = [...KNOWN_MODELS[make]].sort((a, b) => b.length - a.length);
            for (const knownModel of sortedModels) {
                const regex = new RegExp(`\\b${knownModel.toLowerCase()}\\b`, 'i');
                if (titleLower.match(regex)) {
                    model = knownModel;
                    break;
                }
            }
        }

        // --- FALLBACK WORD EXTRACTION ---
        if (!model) {
            const words = title.split(' ');
            if (words.length >= 2) {
                if (words[1] && words[2]) {
                    const twoWords = words[1] + ' ' + words[2];
                    if (twoWords.match(/model [a-z0-9]/i) || twoWords.match(/[a-z] trieda/i)) {
                        model = twoWords;
                    }
                }
                if (!model && words[1] && words[1].length > 1) {
                    model = words[1];
                }
            }
        }

        // --- PERFORMANCE / TRIM REFINEMENT ---
        if (model) {
            // VW Golf -> Golf GTI, Golf R
            if (make === 'Volkswagen' && model === 'Golf') {
                if (titleLower.match(/\bgti\b/)) model = 'Golf GTI';
                else if (titleLower.match(/\bgtd\b/)) model = 'Golf GTD';
                else if (titleLower.match(/\bgte\b/)) model = 'Golf GTE';
                else if (titleLower.match(/\br\b/) || titleLower.match(/\bgolf\s?r\b/)) model = 'Golf R';
            }
            // Škoda -> RS
            if (make === 'Škoda' && ['Octavia', 'Fabia', 'Kodiaq', 'Enyaq'].includes(model)) {
                if (titleLower.match(/\brs\b/)) model = `${model} RS`;
            }
            // Audi -> S/RS
            if (make === 'Audi') {
                // If model is A3, check for S3/RS3 manually if not caught?
                // Actually usually scraped title is "Audi S3", so make=Audi, model=S3 (fallback).
                // But if text is "Audi A3 S-line", we keep A3.
                // If text is "Audi RS6", fallback gets RS6.
                // We mainly care about cases where "Golf" swallows "Golf R".
            }
            // Seat -> Cupra (if older models)
            if (make === 'Seat' && model === 'Leon') {
                if (titleLower.match(/\bcupra\b/)) model = 'Leon Cupra';
                else if (titleLower.match(/\bfr\b/)) model = 'Leon FR';
            }
        }
    }

    return { make, model };
}

module.exports = {
    extractMakeModel
};
