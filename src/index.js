/**
 * src/index.js
 * The Master Orchestrator for the UIC Analytics Engine.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const primeApi = require('./api/prime');
const riotApi = require('./api/riot');
const analytics = require('./core/analytics');
const discordEvents = require('./discord/events');
const discordMessages = require('./discord/messages');

const TEAMS_PATH = path.join(__dirname, '../data/teams.json');
const LEDGER_PATH = path.join(__dirname, '../data/match_database.json');
const STATE_PATH = path.join(__dirname, '../data/player_state.json');

async function runEngine() {
    console.log("🚀 Starting UIC Analytics Modular Engine...");

    try {
        const teamsDb = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
        let ledger = fs.existsSync(LEDGER_PATH) ? JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) : [];
        let playerState = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};

        let teamsUpdated = false;
        let cacheUpdated = false;

        // --- 1. PUUID SYNC ---
        console.log("\n🔍 --- PHASE 1: PUUID SYNCHRONIZATION ---");
        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            for (let player of teamInfo.roster) {
                if (!player.gameName || player.gameName.trim() === "") continue;

                if (player.trackStats !== false && (!player.puuid || player.puuid === "")) {
                    console.log(`   📡 Fetching PUUID for ${player.gameName}...`);
                    const puuid = await riotApi.getPUUID(player.gameName, player.tagLine);
                    if (puuid) {
                        player.puuid = puuid;
                        teamsUpdated = true;
                        console.log(`   ✅ Saved PUUID`);
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
        
        let discordLpBoard = [];
        let discordCarryBoard = [];
        let discordTacticianBoard = [];
        let teamOverviewData = []; 

        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            console.log(`\n🛡️ Processing Group: ${teamInfo.teamDisplay}`);
            let currentTeamData = { teamDisplay: teamInfo.teamDisplay, roster: [], activeRanks: [] };

            for (let player of teamInfo.roster) {
                if (!player.gameName || player.gameName.trim() === "") continue;
                if (player.trackStats === false || !player.puuid) continue;

                const tag = player.tagLine;
                const teamNameShort = teamInfo.teamDisplay.replace("UIC ", ""); 

                // 3A. Fetch Live LP
                const rankData = await riotApi.getRankedData(player.puuid);
                if (rankData) {
                    discordLpBoard.push({ gameName: player.gameName, tagLine: tag, team: teamNameShort, tier: rankData.tier, rank: rankData.rank, lp: rankData.lp });
                    if (player.role !== "MNG" && player.role !== "COH") currentTeamData.activeRanks.push(rankData);
                }

                currentTeamData.roster.push({ gameName: player.gameName, tagLine: tag, role: player.role, isCaptain: player.isCaptain, rankData: rankData, rosterStatus: player.rosterStatus });

                // Skip Analytics for Management/Coaches entirely
                if (player.role === "MNG" || player.role === "COH") continue;

                // 3B. Fetch Last 10 Matches
                const matchIds = await riotApi.getRecentMatches(player.puuid, 10);
                if (!matchIds || matchIds.length === 0) continue;

                const latestMatchId = matchIds[0];
                const cachedState = playerState[player.puuid];

                // 🚀 DELTA CACHE BYPASS 🚀
                if (cachedState && cachedState.lastMatchId === latestMatchId) {
                    console.log(`   ⏭️ Skipped Riot Fetch for ${player.gameName} (No new games)`);
                    if (cachedState.ci && cachedState.ti) {
                        discordCarryBoard.push({ gameName: player.gameName, tagLine: tag, team: teamNameShort, carryIndex: cachedState.ci, tacticianIndex: cachedState.ti });
                        discordTacticianBoard.push({ gameName: player.gameName, tagLine: tag, team: teamNameShort, carryIndex: cachedState.ci, tacticianIndex: cachedState.ti });
                    }
                    continue; 
                }

                console.log(`   🔄 Fetching new data for ${player.gameName}...`);
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
                        if (!ledger.find(e => e.matchId === matchId && e.puuid === player.puuid)) {
                            console.log(`   🏆 Prime Match Detected! Saving to Ledger...`);
                            const websiteStats = analytics.calculateWebsiteLedger(player.puuid, matchData, timelineData);
                            if (websiteStats) {
                                websiteStats.puuid = player.puuid;
                                websiteStats.teamKey = teamKey;
                                ledger.push(websiteStats);
                            }
                        }
                    }
                }

                // 3D. DISCORD GAMIFICATION (Passing player.role for the new filter)
                const discordStats = analytics.calculateDiscordStats(player.puuid, matchDatas, timelineDatas, player.role);
                if (discordStats) {
                    discordCarryBoard.push({ gameName: player.gameName, tagLine: tag, team: teamNameShort, ...discordStats });
                    discordTacticianBoard.push({ gameName: player.gameName, tagLine: tag, team: teamNameShort, ...discordStats });

                    playerState[player.puuid] = { lastMatchId: latestMatchId, ci: discordStats.carryIndex, ti: discordStats.tacticianIndex };
                    cacheUpdated = true;
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

        if (cacheUpdated) {
            fs.writeFileSync(STATE_PATH, JSON.stringify(playerState, null, 2));
            console.log("   ✅ player_state.json cache updated.");
        }

        console.log("\n🎉 Engine Run Complete! All systems nominal.");
    } catch (error) {
        console.error("\n❌ Fatal Engine Error:", error);
    }
}

runEngine();
