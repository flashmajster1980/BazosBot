/**
 * Normalization Service
 * Centralizes logic for inferring and cleaning car data (Fuel, Transmission, Drive, KM)
 * to ensure consistency across Scrapers and Scoring Agents.
 */

class NormalizationService {

    /**
     * Infers fuel type from text (title + description)
     * Priority: Diesel > Electric > Hybrid > Petrol
     */
    static normalizeFuel(text, existingFuel = null) {
        const lowerText = text.toLowerCase();
        let fuel = existingFuel;

        // Improve Regex (add boundaries) and auto-correct if obviously wrong (false positive Elektro)
        const isElectro = fuel === 'Elektro';

        // PRIORITY 0: CNG / LPG (Specific)
        if (lowerText.match(/cng|lpg|g-tec|gtec/)) {
            fuel = 'CNG/LPG';
        }

        // Strict detection - PRIORITY 1: DIESEL
        if (!fuel && lowerText.match(/tdi|\bd\b|crd|cdti|hdi|tdci|dci|jtd|cdi|sdv6|sdv8|ddis|did/)) {
            if (!fuel || (isElectro && !lowerText.includes('hybrid'))) fuel = 'Diesel';
        }
        else if (!fuel && lowerText.match(/\d{3}d\b|\d\.\dd\b|\d{2}d\b/)) { // BMW 320d, 3.0d, 30d
            if (!fuel || (isElectro && !lowerText.includes('hybrid'))) fuel = 'Diesel';
        }

        // PRIORITY 2: ELECTRIC (Strict)
        else if (!fuel && lowerText.match(/elektro|electric|\bev\b|\bid\.3|\bid\.4|\bid\.5|\btesla\b|enyaq|taycan|eqc|eqe|eqs/)) {
            // Exclude potentially ambiguous terms if needed
            if (!fuel) fuel = 'Elektro';
        }

        // PRIORITY 3: PETROL (If no Diesel detected)
        else if (!fuel && lowerText.match(/tsi|tfsi|\bi\b|vtec|gti|mpower|amg/)) {
            if (!fuel || (isElectro && !lowerText.includes('hybrid'))) fuel = 'Benzín';
        }
        else if (lowerText.match(/\d{3}i\b/)) { // BMW 330i
            if (!fuel || (isElectro && !lowerText.includes('hybrid'))) fuel = 'Benzín';
        }

        // Hybrid (Trumps others if explicit)
        if (lowerText.match(/hybrid|phev|mhev/)) {
            fuel = 'Hybrid';
        }

        return fuel;
    }

    /**
     * Infers transmission type
     */
    static normalizeTransmission(text, model, existingTrans = null) {
        let lowerText = text.toLowerCase();
        let transmission = existingTrans;

        if (!transmission) {
            // Remove misleading phrases to prevent false positives
            lowerText = lowerText.replace(/automatická klimatizácia/g, '')
                .replace(/automatická jazda/g, '')
                .replace(/automatické svetlá/g, '')
                .replace(/automatické diaľkové/g, '')
                .replace(/automatické stierače/g, '')
                .replace(/aut\. zabrždění/g, '') // CZ hill hold
                .replace(/aut\. zabrzdenie/g, ''); // SK hill hold

            if (lowerText.match(/automat|dsg|tiptronic|s-tronic|stronic|7g-tronic|9g-tronic/)) transmission = 'Automat';
            else if (lowerText.match(/manuál|manual|6st\.|5st\./)) transmission = 'Manuál';

            // Inference for Premium SUVs (almost always Auto)
            if (!transmission && ['X5', 'X6', 'X7', 'Q7', 'Q8', 'Touareg', 'Cayenne', 'GLE', 'GLS'].includes(model)) {
                transmission = 'Automat';
            }
        }
        return transmission;
    }

    /**
     * Infers drive type (4x4, FWD, RWD)
     */
    static normalizeDrive(text, existingDrive = null) {
        const lowerText = text.toLowerCase();
        let drive = existingDrive;

        if (!drive) {
            if (lowerText.match(/4x4|4wd|awd|quattro|4motion|x-drive|xdrive|allgrip|\bdrive\b/)) drive = '4x4';
            else if (lowerText.match(/zadný|zadny|rwd/)) drive = 'Zadný';
            else drive = 'Predný';

            // Model-based Inference for always-4x4 cars (if still default/Predný)
            // Note: X5 is almost exclusively 4x4.
            if ((!existingDrive || drive === 'Predný') &&
                lowerText.match(/\bx5\b|\bx6\b|\bx7\b|\bq7\b|\bq8\b|\btouareg\b|\bgle\b|\bgls\b|\bcayenne\b/)) {
                drive = '4x4';
            }
        }
        return drive;
    }

    /**
     * Infers KM if missing or 0
     * Tries to find "150000 km" or "150tis" patterns
     */
    static normalizeKm(text, existingKm = null) {
        if (existingKm) return existingKm;
        if (!text) return null;

        // remove spaces
        const cleanText = text.toLowerCase().replace(/\s/g, '');

        // 1. Check for standard "XXXXXX km" or "XXtis"
        const suffixMatch = cleanText.match(/(\d{2,6})[-–\.]?(?:km|tis|tiskm|kilometre|kilometrov)/);
        if (suffixMatch) {
            let val = parseInt(suffixMatch[1]);
            if ((suffixMatch[0].includes('tis') && !suffixMatch[0].includes('tiskm')) || (val < 999 && suffixMatch[0].includes('tis'))) val *= 1000;
            if (val > 100 && val < 900000) return val;
        }

        // 2. Check for Prefix usage: "Najazdené: XXXXXX"
        // Strategy: Match "najazden" followed by non-digits (like "ých km:"), then the number.
        const prefixMatch = cleanText.match(/najazden[^\d]*(\d{3,6})/);
        if (prefixMatch) {
            let val = parseInt(prefixMatch[1]);
            if (val > 100 && val < 900000) return val;
        }

        return null;
    }

    /**
     * Master function to normalize a listing object
     */
    static normalizeListing(listing) {
        const text = (listing.title + ' ' + (listing.description || '')).toLowerCase();
        const model = listing.model || '';

        listing.transmission = this.normalizeTransmission(text, model, listing.transmission);
        listing.drive = this.normalizeDrive(text, listing.drive);
        listing.fuel = this.normalizeFuel(text, listing.fuel);

        // Pass full text for KM inference (Title has priority in logic if needed, but here we pass full text)
        // Note: normalizeKm logic searches for "150tis" etc.
        // It's better to verify Title first, then Description if Title fails?
        // Current normalizeKm implements basic regex.
        // Let's iterate: check Title first (high confidence), if null, check full text.

        let km = this.normalizeKm(listing.title, listing.km);
        if (!km) {
            km = this.normalizeKm(text, listing.km);
        }
        listing.km = km;

        return listing;
    }
}

module.exports = NormalizationService;
