// Race Selection Controller
const db = require('../config/database');

class RaceController {
    // Lade alle verfügbaren Rassen aus der Datenbank
    async getAvailableRaces() {
        try {
            console.log('Loading available races from database...');
            
            const races = await db.query(`
                SELECT 
                    r.*,
                    COUNT(u.id) as unit_count
                FROM races r
                LEFT JOIN units u ON r.id = u.race_id
                GROUP BY r.id
                ORDER BY r.name
            `);

            console.log(`Found ${races.length} races in database`);
            return { success: true, races: races };

        } catch (error) {
            console.error('Error loading races:', error);
            return { success: false, message: 'Fehler beim Laden der Rassen: ' + error.message };
        }
    }

    // Lade Details einer spezifischen Rasse mit ihren Einheiten
    async getRaceDetails(raceId) {
        try {
            console.log(`Loading race details for race ID: ${raceId}`);

            // Lade Rasseninformationen
            const raceInfo = await db.query(
                'SELECT * FROM races WHERE id = ?',
                [raceId]
            );

            if (raceInfo.length === 0) {
                return { success: false, message: '