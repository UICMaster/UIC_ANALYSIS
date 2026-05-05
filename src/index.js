/**
 * src/index.js
 * The Master Orchestrator for the UIC Analytics Engine.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Import Modules
const primeApi = require('./api/prime');
const riotApi = require('./api/riot');
const analytics = require('./core/analytics');
const discordEvents = require('./discord/events');
const discordMessages = require('./discord/messages');

// File Paths
const TEAMS_PATH = path.join(__dirname, '../data/teams.json');
const LEDGER_PATH = path.join(__dirname, '../data/match_database.json');

async function runEngine() {
    console.log("🚀 Starting UIC Analytics Modular Engine...");

    try {
        // --- 0. INITIALIZATION ---
        const teamsDb = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
        
        let ledger = [];
        if (fs.existsSync(LEDGER_PATH)) {
            ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
        }

        // --- 1. PRIME SCHEDULE & DISCORD EVENTS ---
        console.log("\n📅 --- PHASE 1: PRIME SCHEDULE & EVENTS ---");
        const scoutingData = await primeApi.fetchPrimeData(teamsDb);
        
        if (scoutingData.length > 0) {
            for (const match of scoutingData) {
                await discordEvents.syncMatchEvent(match);
            }
        } else {
            console.log("💤 No upcoming Prime matches found today.");
        }

        // --- 2. PLAYER DATA ACQUISITION & ANALYTICS ---
        console.log("\n🧠 --- PHASE 2: RIOT DATA & LEDGER COMPILATION ---");
        
        let lpLeaderboard = [];
        let carryIndex = [];
        let tacticianLedger = [];
        let teamsUpdated = false;

        // Loop through every team and player in the Golden Database
        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            console.log(`\n🛡️ Processing Team: ${teamInfo.teamDisplay}`);

            for (let i = 0; i < teamInfo.roster.length; i++) {
                let player = teamInfo.roster[i];
                if (!player.trackStats) continue;

                // 2A. Get or Update PUUID
                if (!player.puuid || player.puuid === "") {
                    const puuid = await riotApi.getPUUID(player.gameName, player.tagLine);
                    if (puuid) {
                        player.puuid = puuid;
                        teamsUpdated = true;
                        console.log(`   📝 Saved PUUID for ${player.gameName}`);
                    } else {
                        console.log(`   ❌ Could not find account for ${player.gameName}`);
                        continue;
                    }
                }

                // 2B. Fetch SoloQ LP for the Discord Leaderboard
                const rankData = await riotApi.getRankedData(player.puuid);
                if (rankData) {
                    lpLeaderboard.push({
                        gameName: player.gameName,
                        discordId: player.discordId,
                        tier: rankData.tier,
                        rank: rankData.rank,
                        lp: rankData.lp
                    });
                }

                // 2C. Fetch Recent Matches and Update Ledger
                const recentMatches = await riotApi.getRecentMatches(player.puuid, 5);
                if (!recentMatches) continue;

                let playerCompetitiveStats = [];

                for (const matchId of recentMatches) {
                    // Check if we already processed this exact match for this exact player
                    const existingEntry = ledger.find(entry => entry.matchId === matchId && entry.puuid === player.puuid);
                    
                    if (existingEntry) {
                        if (existingEntry.isCompetitive) playerCompetitiveStats.push(existingEntry);
                        continue;
                    }

                    // Not in ledger -> Fetch from Riot
                    const matchData = await riotApi.getMatchData(matchId);
                    const timelineData = await riotApi.getMatchTimeline(matchId);

                    if (matchData && timelineData) {
                        const stats = analytics.calculatePlayerStats(player.puuid, matchData, timelineData);
                        if (stats) {
                            // Queue 0 is Custom Games, 124 is Tournament Draft (Prime League uses these)
                            const isCompetitive = matchData.info.queueId === 0 || matchData.info.queueId === 124;
                            
                            // Attach identifiers for the Website Frontend
                            stats.puuid = player.puuid;
                            stats.teamKey = teamKey;
                            stats.discordId = player.discordId;
                            stats.isCompetitive = isCompetitive;

                            ledger.push(stats); // Add to permanent history
                            if (isCompetitive) playerCompetitiveStats.push(stats);
                            console.log(`   ✅ Added Match ${matchId} to Ledger for ${player.gameName}`);
                        }
                    }
                }

                // 2D. Calculate Discord Averages (Based ONLY on Competitive/Prime Games)
                if (playerCompetitiveStats.length > 0) {
                    const totalGames = playerCompetitiveStats.length;
                    const avgGd15 = Math.round(playerCompetitiveStats.reduce((sum, s) => sum + s.gd15, 0) / totalGames);
                    const avgDmgGold = parseFloat((playerCompetitiveStats.reduce((sum, s) => sum + s.dmgPerGold, 0) / totalGames).toFixed(2));
                    const avgKp = parseFloat((playerCompetitiveStats.reduce((sum, s) => sum + s.kp, 0) / totalGames).toFixed(1));
                    const avgVspm = parseFloat((playerCompetitiveStats.reduce((sum, s) => sum + s.vspm, 0) / totalGames).toFixed(2));

                    if (player.role === "TOP" || player.role === "MID") {
                        carryIndex.push({ gameName: player.gameName, discordId: player.discordId, gd15: avgGd15, dmgPerGold: avgDmgGold });
                    } else if (player.role === "JGL" || player.role === "SUP" || player.role === "UTILITY") {
                        tacticianLedger.push({ gameName: player.gameName, discordId: player.discordId, kp: avgKp, vspm: avgVspm });
                    }
                }
            }
        }

        // --- 3. DISCORD LEADERBOARD DELIVERY ---
        console.log("\n📊 --- PHASE 3: UPDATING DISCORD LEADERBOARDS ---");
        if (lpLeaderboard.length > 0) await discordMessages.updateLpLeaderboard(lpLeaderboard);
        if (carryIndex.length > 0) await discordMessages.updateCarryIndex(carryIndex);
        if (tacticianLedger.length > 0) await discordMessages.updateTacticianLedger(tacticianLedger);

        // --- 4. DATA EXPORT ---
        console.log("\n💾 --- PHASE 4: SAVING DATA ---");
        
        // Save the updated ledger (The Website Database)
        fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
        console.log("   ✅ match_database.json successfully saved.");

        // If we found new PUUIDs, save them back to teams.json so we never fetch them again
        if (teamsUpdated) {
            fs.writeFileSync(TEAMS_PATH, JSON.stringify(teamsDb, null, 2));
            console.log("   ✅ teams.json updated with new PUUIDs.");
        }

        console.log("\n🎉 Engine Run Complete! All systems nominal.");

    } catch (error) {
        console.error("❌ Fatal Engine Error:", error);
    }
}

// Start the engine
runEngine();
