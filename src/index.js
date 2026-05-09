/**
 * src/index.js
 * The Master Orchestrator: Version 2.0 (High Performance)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const riotApi = require('./api/riot');
const primeApi = require('./api/prime');
const analytics = require('./core/analytics');
const discord = require('./discord/messages');
const { processInBatches } = require('./utils/network');

// Paths
const DATA_DIR = path.join(__dirname, '../data');
const MATCHES_DIR = path.join(DATA_DIR, 'matches');
const TEAMS_PATH = path.join(DATA_DIR, 'teams.json');
const STATE_PATH = path.join(DATA_DIR, 'player_state.json');

// Ensure matches directory exists for Repo B
if (!fs.existsSync(MATCHES_DIR)) fs.mkdirSync(MATCHES_DIR, { recursive: true });

async function runEngine() {
    console.log("🚀 UIC Analytics Engine 2.0: Starting High-Performance Run...");

    try {
        const teamsDb = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
        const playerState = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
        
        let teamsUpdated = false;
        let stateUpdated = false;

        // --- PHASE 1: PUUID & NAME SYNC ---
        // Critical for "Web GUI" users: Auto-corrects names in teams.json if players rename.
        console.log("\n🔍 [Phase 1] Syncing Account Identities...");
        for (const team of Object.values(teamsDb)) {
            for (const player of team.roster) {
                if (!player.gameName || player.trackStats === false) continue;

                // If PUUID is missing, or we want to verify name changes
                const riotAccount = await riotApi.getPUUID(player.gameName, player.tagLine);
                if (riotAccount) {
                    if (player.puuid !== riotAccount.puuid) {
                        player.puuid = riotAccount.puuid;
                        teamsUpdated = true;
                    }
                    // Auto-correction: If Riot returns a different name than our JSON, update our JSON.
                    if (player.gameName !== riotAccount.gameName) {
                        console.log(`   📝 Name Change Detected: ${player.gameName} -> ${riotAccount.gameName}`);
                        player.gameName = riotAccount.gameName;
                        player.tagLine = riotAccount.tagLine;
                        teamsUpdated = true;
                    }
                }
            }
        }

        // --- PHASE 2: PRIME SCHEDULE & EVENTS ---
        console.log("\n📅 [Phase 2] Managing Prime League Events...");
        const scoutingData = await primeApi.fetchPrimeData(teamsDb);
        for (const match of scoutingData) {
            await discord.syncMatchEvent(match);
        }

        // --- PHASE 3: THE DATA GATHERING (BATCHED) ---
        console.log("\n🧠 [Phase 3] Gathering Performance Data...");
        const lpBoard = [];
        const powerBoard = [];

        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            console.log(`\n🛡️  Processing Team: ${teamInfo.teamDisplay}`);
            const teamNameShort = teamInfo.teamDisplay.replace("UIC ", "");

            // Process players in batches of 5 to maximize Riot's 100/1min limit safely
            await processInBatches(teamInfo.roster, 5, 1200, async (player) => {
                if (!player.puuid || player.trackStats === false) return;

                // 1. Fetch Current Rank
                const rank = await riotApi.getRankedData(player.puuid);
                if (rank) {
                    lpBoard.push({ ...rank, gameName: player.gameName, team: teamNameShort });
                }

                // 2. Fetch SoloQ History for Power Rankings
                const soloMatchIds = await riotApi.getRecentMatches(player.puuid, 5, 420);
                if (soloMatchIds && soloMatchIds.length > 0) {
                    const latestId = soloMatchIds[0];
                    const cache = playerState[player.puuid] || {};

                    // Delta Cache: Skip analysis if no new games played
                    if (cache.lastSoloId === latestId) {
                        powerBoard.push({ ...cache.lastScores, gameName: player.gameName, team: teamNameShort });
                    } else {
                        console.log(`   🔄 Calculating SoloQ Power: ${player.gameName}`);
                        const matchData = await riotApi.getMatchData(latestId);
                        const timeline = await riotApi.getMatchTimeline(latestId);
                        const scores = analytics.calculateIndices(player.puuid, matchData, timeline, player.role);
                        
                        if (scores) {
                            powerBoard.push({ ...scores, gameName: player.gameName, team: teamNameShort });
                            playerState[player.puuid] = { ...cache, lastSoloId: latestId, lastScores: scores };
                            stateUpdated = true;
                        }
                    }
                }

                // 3. PRIME MATCH DETECTION (Custom Games)
                // Check if any scouting reports match our current team
                const activeMatch = scoutingData.find(m => m.myTeam === teamKey);
                if (activeMatch) {
                    const customIds = await riotApi.getRecentMatches(player.puuid, 3, 'custom');
                    for (const cid of customIds) {
                        // Check if we've already analyzed this Prime Match
                        if (fs.existsSync(path.join(MATCHES_DIR, `match_${cid}.json`))) continue;

                        const cMatch = await riotApi.getMatchData(cid);
                        // Temporal Correlation: Match must be within 2 hours of Prime schedule
                        const matchTime = new Date(cMatch.info.gameCreation).getTime();
                        const primeTime = new Date(activeMatch.matchTime).getTime();
                        const diffHours = Math.abs(matchTime - primeTime) / 36e5;

                        if (diffHours < 2) {
                            console.log(`   🏆 Prime Match Detected! MatchID: ${cid}`);
                            const cTimeline = await riotApi.getMatchTimeline(cid);
                            const forensicData = analytics.calculateWebsiteLedger(player.puuid, cMatch, cTimeline, player.role);
                            
                            if (forensicData) {
                                // Save unique match file for Repo B
                                fs.writeFileSync(path.join(MATCHES_DIR, `match_${cid}.json`), JSON.stringify(forensicData, null, 2));
                                // Post summary to Discord Hype channel
                                await discord.postMatchSummary({
                                    teamName: teamNameShort,
                                    enemyName: activeMatch.enemyTeamName,
                                    win: forensicData.win,
                                    players: [forensicData] // Note: In a full run, you'd aggregate all 5 teammates here
                                });
                            }
                        }
                    }
                }
            });
        }

        // --- PHASE 4: DELIVERY ---
        console.log("\n📊 [Phase 4] Delivering to Discord...");
        if (lpBoard.length) await discord.updateLpLeaderboard(lpBoard);
        if (powerBoard.length) await discord.updatePowerRankings(powerBoard);

        // --- PHASE 5: PERSISTENCE ---
        if (teamsUpdated) fs.writeFileSync(TEAMS_PATH, JSON.stringify(teamsDb, null, 2));
        if (stateUpdated) fs.writeFileSync(STATE_PATH, JSON.stringify(playerState, null, 2));
        
        console.log("\n✅ Engine Run Complete. Repo B data synced.");

    } catch (error) {
        console.error("\n❌ FATAL ENGINE ERROR:", error);
    }
}

runEngine();
