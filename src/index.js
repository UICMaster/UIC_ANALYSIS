/**
 * src/index.js
 * The Master Orchestrator for the UIC Analytics Engine.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Import our custom modules
const primeApi = require('./api/prime');
const riotApi = require('./api/riot');
const analytics = require('./core/analytics');

async function runEngine() {
    console.log("🚀 Starting UIC Analytics Modular Engine...");

    try {
        // 1. Load the Organization Database
        const teamsPath = path.join(__dirname, '../data/teams.json');
        const teamsDb = JSON.parse(fs.readFileSync(teamsPath, 'utf8'));

        // 2. Fetch Prime League Matchups
        console.log("\n📡 --- PHASE 1: PRIME LEAGUE SCHEDULE ---");
        const scoutingData = await primeApi.fetchPrimeData(teamsDb);

        if (scoutingData.length === 0) {
            console.log("🛑 No active matchups found. Engine going to sleep to save API limits.");
            return; // Exit the script gracefully
        }

        let finalCompiledData = {
            lastUpdated: new Date().toISOString(),
            matchups: []
        };

        // 3. Process each found matchup
        console.log("\n🧠 --- PHASE 2 & 3: RIOT API & ANALYTICS ---");
        for (const match of scoutingData) {
            console.log(`\n⚔️ Processing Matchup: ${match.myTeam.toUpperCase()} vs ${match.enemyTeamName}`);
            
            const teamConfig = teamsDb[match.myTeam];
            let teamReport = {
                teamKey: match.myTeam,
                enemyName: match.enemyTeamName,
                matchTime: match.matchTime,
                isPredicted: match.isPredicted,
                players: []
            };

            // Loop through our starting 5 players
            for (const starterNameTag of match.myStarters) {
                // Parse "GameName#TagLine"
                const [gameName, tagLine] = starterNameTag.split('#');
                
                // Find player in our database to see if we already have their PUUID
                let dbPlayer = teamConfig.roster.find(p => p.gameName === gameName && p.tagLine === tagLine);
                let puuid = dbPlayer ? dbPlayer.puuid : "";

                // If PUUID is missing, fetch it via Riot Account-V1
                if (!puuid || puuid === "") {
                    puuid = await riotApi.getPUUID(gameName, tagLine);
                    if (puuid) {
                        console.log(`   [SAVE THIS] 📝 PUUID for ${starterNameTag}: ${puuid}`);
                    } else {
                        console.log(`   ❌ Could not find Riot Account for ${starterNameTag}. Skipping.`);
                        continue;
                    }
                }

                // Fetch last 5 match IDs
                const recentMatchIds = await riotApi.getRecentMatches(puuid, 5);
                if (!recentMatchIds || recentMatchIds.length === 0) continue;

                let playerStatsArray = [];

                // Fetch data for each match
                for (const matchId of recentMatchIds) {
                    const matchData = await riotApi.getMatchData(matchId);
                    const timelineData = await riotApi.getMatchTimeline(matchId);
                    
                    if (matchData && timelineData) {
                        const stats = analytics.calculatePlayerStats(puuid, matchData, timelineData);
                        if (stats) playerStatsArray.push(stats);
                    }
                }

                // Crunch the averages
                const averages = analytics.calculateAverages(playerStatsArray);
                
                if (averages) {
                    teamReport.players.push({
                        gameName: gameName,
                        tagLine: tagLine,
                        role: dbPlayer ? dbPlayer.role : "UNKNOWN",
                        recentGamesData: averages
                    });
                    console.log(`   ✅ Successfully compiled stats for ${gameName} (${averages.winRate}% WR, ${averages.avgGd15} GD@15)`);
                }
            }

            finalCompiledData.matchups.push(teamReport);
        }

        // 4. Save the Output for the Website / Discord
        console.log("\n💾 --- PHASE 4: DATA DELIVERY ---");
        
        // Write the data to a local file. (Your GitHub Action will push this to the data-output branch)
        const outputPath = path.join(__dirname, '../compiled_data.json');
        fs.writeFileSync(outputPath, JSON.stringify(finalCompiledData, null, 2));
        
        console.log("✅ Engine Run Complete. Data saved to compiled_data.json");

    } catch (error) {
        console.error("❌ Fatal Engine Error:", error);
    }
}

// Start the engine
runEngine();
