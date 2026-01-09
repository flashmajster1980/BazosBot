const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'listings.json');
const raw = fs.readFileSync(file, 'utf-8');
const listings = JSON.parse(raw);

const target = listings.find(l =>
    l.title.toLowerCase().includes('bmw x5 m m60i') ||
    (l.description && l.description.toLowerCase().includes('bmw x5 m m60i'))
);

if (target) {
    console.log('--- FOUND LISTING ---');
    console.log(JSON.stringify(target, null, 2));
} else {
    console.log('Listing not found via exact match.');
}
