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

        let teamsUpdated = false;

        // --- 1. PUUID SYNC ---
        console.log("\n🔍 --- PHASE 1: PUUID SYNCHRONIZATION ---");
        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            for (let player of teamInfo.roster) {
                if (player.trackStats !== false && (!player.puuid || player.puuid === "")) {
                    console.log(`   📡 Fetching PUUID for ${player.gameName}#${player.tagLine}...`);
                    const puuid = await riotApi.getPUUID(player.gameName, player.tagLine);
                    if (puuid) {
                        player.puuid = puuid;
                        teamsUpdated = true;
                        console.log(`   ✅ Saved PUUID for ${player.gameName}`);
                    } else {
                        console.log(`   ❌ Could not find account for ${player.gameName}`);
                    }
                }
            }
        }

        // --- 2. PRIME SCHEDULE & DISCORD EVENTS ---
        console.log("\n📅 --- PHASE 2: PRIME SCHEDULE & EVENTS ---");
        const scoutingData = await primeApi.fetchPrimeData(teamsDb);
        if (scoutingData && scoutingData.length > 0) {
            for (const match of scoutingData) {
                await discordEvents.syncMatchEvent(match);
            }
        } else {
            console.log("   💤 No upcoming Prime matches found today.");
        }

        // --- 3. THE GREAT DATA PULL (RIOT API) ---
        console.log("\n🧠 --- PHASE 3: RIOT DATA ACQUISITION ---");
        console.log("   ⏳ Note: Timelines now required for Discord Stats. ETA: ~10 mins.");
        
        let discordLpBoard = [];
        let discordCarryBoard = [];
        let discordTacticianBoard = [];
        let teamOverviewData = []; 

        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            console.log(`\n🛡️ Processing Group: ${teamInfo.teamDisplay}`);
            
            let currentTeamData = {
                teamDisplay: teamInfo.teamDisplay,
                roster: [],
                activeRanks: [] 
            };

            for (let player of teamInfo.roster) {
                if (player.trackStats === false || !player.puuid) continue;

                const tag = player.tagLine;
                const teamNameShort = teamInfo.teamDisplay.replace("UIC ", ""); 

                // 3A. Fetch Live LP
                const rankData = await riotApi.getRankedData(player.puuid);
                if (rankData) {
                    discordLpBoard.push({
                        gameName: player.gameName, tagLine: tag, team: teamNameShort,
                        tier: rankData.tier, rank: rankData.rank, lp: rankData.lp
                    });
                    
                    if (player.role !== "MNG" && player.role !== "COH") {
                        currentTeamData.activeRanks.push(rankData);
                    }
                }

                // HIER IST DER FIX: tagLine: tag wurde hinzugefügt
                currentTeamData.roster.push({
                    gameName: player.gameName, tagLine: tag, role: player.role, isCaptain: player.isCaptain, rankData: rankData
                });

                // 3B. Fetch Last 10 Matches
                const matchIds = await riotApi.getRecentMatches(player.puuid, 10);
                if (!matchIds || matchIds.length === 0) continue;

                let matchDatas = [];
                let timelineDatas = [];

                for (const matchId of matchIds) {
                    const matchData = await riotApi.getMatchData(matchId);
                    if (!matchData) continue;
                    
                    const timelineData = await riotApi.getMatchTimeline(matchId);
                    if (!timelineData) continue;

                    matchDatas.push(matchData);
                    timelineDatas.push(timelineData);

                    // 3C. WEBSITE LEDGER
                    const isCompetitive = matchData.info.queueId === 0 || matchData.info.queueId === 124;
                    if (isCompetitive) {
                        const exists = ledger.find(e => e.matchId === matchId && e.puuid === player.puuid);
                        if (!exists) {
                            console.log(`   🏆 Prime Match Detected! Saving to Ledger for ${player.gameName}...`);
                            const websiteStats = analytics.calculateWebsiteLedger(player.puuid, matchData, timelineData);
                            if (websiteStats) {
                                websiteStats.puuid = player.puuid;
                                websiteStats.teamKey = teamKey;
                                ledger.push(websiteStats);
                                console.log(`   ✅ Saved Prime Stats for ${player.gameName}`);
                            }
                        }
                    }
                }

                // 3D. DISCORD GAMIFICATION
                const discordStats = analytics.calculateDiscordStats(player.puuid, matchDatas, timelineDatas);
                if (discordStats) {
                    discordCarryBoard.push({
                        gameName: player.gameName, tagLine: tag, team: teamNameShort,
                        ...discordStats
                    });
                    
                    discordTacticianBoard.push({
                        gameName: player.gameName, tagLine: tag, team: teamNameShort,
                        ...discordStats
                    });
                }
            }
            
            teamOverviewData.push(currentTeamData);
        }

        // --- 4. DISCORD DELIVERY ---
        console.log("\n📊 --- PHASE 4: DISCORD DELIVERY ---");
        if (discordLpBoard.length > 0) await discordMessages.updateLpLeaderboard(discordLpBoard);
        if (discordCarryBoard.length > 0) await discordMessages.updateCarryIndex(discordCarryBoard);
        if (discordTacticianBoard.length > 0) await discordMessages.updateTacticianLedger(discordTacticianBoard);
        if (teamOverviewData.length > 0) await discordMessages.updateTeamOverview(teamOverviewData);

        // --- 5. DATA EXPORT ---
        console.log("\n💾 --- PHASE 5: SAVING DATA ---");
        fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
        console.log("   ✅ match_database.json safely secured.");

        if (teamsUpdated) {
            fs.writeFileSync(TEAMS_PATH, JSON.stringify(teamsDb, null, 2));
            console.log("   ✅ teams.json updated with new PUUIDs.");
        }

        console.log("\n🎉 Engine Run Complete! All systems nominal.");

    } catch (error) {
        console.error("\n❌ Fatal Engine Error:", error);
    }
}

// Start the engine
runEngine();
