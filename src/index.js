require('dotenv').config();
const fs = require('fs');

// Import our custom modules
const primeApi = require('./api/prime');
const riotApi = require('./api/riot');
const analytics = require('./core/analytics');
const discordEvents = require('./discord/events');
const discordMessages = require('./discord/messages');

async function runEngine() {
    console.log("🚀 Starting UIC Analytics Modular Engine...");

    try {
        // 1. Load Database
        const teamsDb = JSON.parse(fs.readFileSync('./data/teams.json', 'utf8'));

        // 2. Fetch Prime League Matchups
        console.log("📡 Phase 1: Checking Prime Bot API...");
        const scoutingData = await primeApi.fetchPrimeData(teamsDb);

        if (scoutingData.length === 0) {
            console.log("🛑 No active matchups found. Engine going to sleep.");
            return;
        }

        // 3. Process each found matchup
        for (const match of scoutingData) {
            console.log(`⚔️ Processing Matchup: ${match.myTeam} vs ${match.enemyTeamName}`);
            
            // TODO: Call Riot API to get PUUIDs and History
            // const matchStats = await riotApi.getDeepStats(match);
            
            // TODO: Calculate advanced metrics (GD@15, Damage/Gold)
            // const analyticsReport = analytics.generateReport(matchStats);

            // TODO: Create/Update Discord Event
            // await discordEvents.createOrUpdateEvent(match, analyticsReport);
        }

        // 4. Update the Leaderboards (Runs regardless of matches)
        console.log("📊 Phase 4: Updating Organizational Leaderboards...");
        // await discordMessages.updateLeaderboards(teamsDb);

        console.log("✅ Engine Run Complete.");

    } catch (error) {
        console.error("❌ Fatal Engine Error:", error);
    }
}

runEngine();
