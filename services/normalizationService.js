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

        // Strict detection - PRIORITY 1: DIESEL
        if (lowerText.match(/tdi|\bd\b|crd|cdti|hdi|tdci|dci|jtd|cdi|sdv6|sdv8|ddis|did/)) {
            if (!fuel || (isElectro && !lowerText.includes('hybrid'))) fuel = 'Diesel';
        }
        else if (lowerText.match(/\d{3}d\b/)) { // BMW 320d
            if (!fuel || (isElectro && !lowerText.includes('hybrid'))) fuel = 'Diesel';
        }

        // PRIORITY 2: ELECTRIC (Strict)
        else if (lowerText.match(/elektro|electric|\bev\b|\bid\.3|\bid\.4|\bid\.5|\btesla\b|enyaq|taycan|eqc|eqe|eqs/)) {
            // Exclude potentially ambiguous terms if needed
            if (!fuel) fuel = 'Elektro';
        }

        // PRIORITY 3: PETROL (If no Diesel detected)
        else if (lowerText.match(/tsi|tfsi|\bi\b|vtec|gti|mpower|amg/)) {
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
        const lowerText = text.toLowerCase();
        let transmission = existingTrans;

        if (!transmission) {
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
        let km = existingKm;

        if (!km || km == 0) {
            // Remove spaces for easier matching: "150 000" -> "150000"
            const cleanText = text.toLowerCase().replace(/\s/g, '');
            const kmMatch = cleanText.match(/(\d{2,6})(?:km|tis|tiskm)/);

            if (kmMatch) {
                let val = parseInt(kmMatch[1]);
                // Handle "150tis"
                if ((text.match(/tis/i) && !text.match(/tis km/i)) || cleanText.match(/tiskm/)) {
                    if (val < 999) val *= 1000;
                }

                // Sanity check (100km to 900k km)
                if (val > 100 && val < 900000) km = val;
            }
        }
        return km;
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
        listing.km = this.normalizeKm(listing.title, listing.km); // Use Title mostly for KM inference

        return listing;
    }
}

module.exports = NormalizationService;
