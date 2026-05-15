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
const discordMessages = require('./discord/messages');
const discordRoles = require('./discord/roles'); 

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

        console.log("\n🔍 --- PHASE 1: PUUID & NAME SYNCHRONIZATION ---");
        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            for (let player of teamInfo.roster) {
                if (player.trackStats === false) continue;

                if (!player.puuid || player.puuid === "") {
                    if (!player.gameName || player.gameName.trim() === "") continue;
                    console.log(`   📡 Fetching PUUID for ${player.gameName}...`);
                    const puuid = await riotApi.getPUUID(player.gameName, player.tagLine);
                    if (puuid) {
                        player.puuid = puuid;
                        teamsUpdated = true;
                        console.log(`   ✅ Saved PUUID`);
                    }
                } else {
                    const liveAccount = await riotApi.getAccountByPUUID(player.puuid);
                    if (liveAccount && liveAccount.gameName) {
                        if (player.gameName !== liveAccount.gameName || player.tagLine !== liveAccount.tagLine) {
                            console.log(`   ✨ Name Healed! ${player.gameName} -> ${liveAccount.gameName}#${liveAccount.tagLine}`);
                            player.gameName = liveAccount.gameName;
                            player.tagLine = liveAccount.tagLine;
                            teamsUpdated = true;
                        }
                    }
                }
            }
        }

        console.log("\n📅 --- PHASE 2: PRIME MATCHUPS (For Cross-Referencing) ---");
        const scoutingData = await primeApi.fetchPrimeData(teamsDb);
        if (!scoutingData || scoutingData.length === 0) {
            console.log("   💤 No upcoming Prime matches found today.");
        } else {
            console.log(`   ✅ Loaded ${scoutingData.length} matchups for verification.`);
        }

        console.log("\n🧠 --- PHASE 3: RIOT DATA ACQUISITION ---");
        
        let discordLpBoard = [];
        let discordMasterBoard = []; 
        let teamOverviewData = []; 

        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            console.log(`\n🛡️ Processing Group: ${teamInfo.teamDisplay}`);
            let currentTeamData = { teamDisplay: teamInfo.teamDisplay, roster: [], activeRanks: [] };
            const activeScout = scoutingData.find(s => s.myTeam === teamKey);

            for (let player of teamInfo.roster) {
                if (!player.gameName || player.gameName.trim() === "") continue;
                if (player.trackStats === false || !player.puuid) continue;

                const teamNameShort = teamInfo.teamDisplay.replace("UIC ", ""); 

                // 1. Fetch Rank Data
                const rankData = await riotApi.getRankedData(player.puuid);

                // 🚀 2. DISCORD ROLE SYNC 🚀
                if (player.discordId && player.discordId !== "") {
                    await discordRoles.syncPlayerRank(player, rankData ? rankData.tier : "UNRANKED");
                }

                if (rankData) {
                    discordLpBoard.push({ gameName: player.gameName, tagLine: player.tagLine, team: teamNameShort, tier: rankData.tier, rank: rankData.rank, lp: rankData.lp });
                    if (player.role !== "MNG" && player.role !== "COH") currentTeamData.activeRanks.push(rankData);
                }

                // 3. Match Processing (Fetch 20 to guarantee we find 10 SoloQ games)
                const matchIds = await riotApi.getRecentMatches(player.puuid, 20);
                if (!matchIds || matchIds.length === 0) {
                    currentTeamData.roster.push({ gameName: player.gameName, tagLine: player.tagLine, role: player.role, isCaptain: player.isCaptain, rankData: rankData, rosterStatus: player.rosterStatus });
                    continue;
                }

                const latestMatchId = matchIds[0];
                const cachedState = playerState[player.puuid];

                if (player.role !== "MNG" && player.role !== "COH" && cachedState && cachedState.lastMatchId === latestMatchId) {
                    console.log(`   ⏭️ Skipped Riot Fetch for ${player.gameName} (No new games)`);
                    if (cachedState.ups) {
                        discordMasterBoard.push({ gameName: player.gameName, tagLine: player.tagLine, team: teamNameShort, metrics: cachedState });
                    }
                    currentTeamData.roster.push({ gameName: player.gameName, tagLine: player.tagLine, role: player.role, isCaptain: player.isCaptain, rankData: rankData, rosterStatus: player.rosterStatus });
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

                    const isCompetitive = matchData.info.queueId === 0 || matchData.info.queueId === 124;
                    if (isCompetitive) {
                        if (!ledger.find(e => e.matchId === matchId && e.puuid === player.puuid)) {
                            let isVerifiedPrime = false;

                            if (activeScout) {
                                // Match Riot Name strictly by splitting off #TagLine to match Prime API predictions
                                const matchNames = matchData.info.participants.map(p => 
                                    (p.riotIdGameName || p.summonerName || "").split('#')[0].toLowerCase().replace(/\s+/g, '')
                                );
                                const expectedEnemies = activeScout.enemyStarters.map(name => 
                                    name.split('#')[0].toLowerCase().replace(/\s+/g, '')
                                );
                                const matchedEnemies = expectedEnemies.filter(enemy => matchNames.includes(enemy));

                                if (matchedEnemies.length >= 2) {
                                    isVerifiedPrime = true;
                                    console.log(`   🎯 Prime Match Verified: Found enemy players (${matchedEnemies.join(', ')})`);
                                }
                            }
                            if (isVerifiedPrime) {
                                console.log(`   🏆 Saving Verified Match to Ledger...`);
                                const websiteStats = analytics.calculateWebsiteLedger(player.puuid, matchData, timelineData);
                                if (websiteStats) {
                                    websiteStats.puuid = player.puuid;
                                    websiteStats.teamKey = teamKey;
                                    ledger.push(websiteStats);
                                }
                            }
                        }
                    }
                }

                currentTeamData.roster.push({ gameName: player.gameName, tagLine: player.tagLine, role: player.role, isCaptain: player.isCaptain, rankData: rankData, rosterStatus: player.rosterStatus });

                if (player.role === "MNG" || player.role === "COH") continue;

                const metrics = analytics.calculateDiscordStats(player.puuid, matchDatas, timelineDatas, player.role);
                if (metrics) {
                    discordMasterBoard.push({ gameName: player.gameName, tagLine: player.tagLine, team: teamNameShort, metrics: metrics });
                    playerState[player.puuid] = { lastMatchId: latestMatchId, ...metrics };
                    cacheUpdated = true;
                }
            }
            teamOverviewData.push(currentTeamData);
        }

        console.log("\n📊 --- PHASE 4: DISCORD DELIVERY ---");
        if (discordLpBoard.length > 0) await discordMessages.updateLpLeaderboard(discordLpBoard);
        if (discordMasterBoard.length > 0) await discordMessages.updateMasterLeaderboard(discordMasterBoard);
        if (teamOverviewData.length > 0) await discordMessages.updateTeamOverview(teamOverviewData);

        console.log("\n💾 --- PHASE 5: SAVING DATA ---");
        fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
        console.log("   ✅ match_database.json safely secured.");

        if (teamsUpdated) {
            fs.writeFileSync(TEAMS_PATH, JSON.stringify(teamsDb, null, 2));
            console.log("   ✅ teams.json updated with Live Account Data.");
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
