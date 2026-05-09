require('dotenv').config();
const fs = require('fs');
const path = require('path');
const riotApi = require('./api/riot');
const primeApi = require('./api/prime');
const analytics = require('./core/analytics');
const discord = require('./discord/messages');
const { processInBatches } = require('./utils/network');

const DATA_DIR = path.join(__dirname, '../data');
const MATCHES_DIR = path.join(DATA_DIR, 'matches');
const TEAMS_PATH = path.join(DATA_DIR, 'teams.json');
const STATE_PATH = path.join(DATA_DIR, 'player_state.json');

if (!fs.existsSync(MATCHES_DIR)) fs.mkdirSync(MATCHES_DIR, { recursive: true });

async function runEngine() {
    try {
        const teamsDb = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
        const playerState = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
        let teamsUpdated = false, stateUpdated = false;

        // --- PHASE 1: IDENTITY SYNC ---
        for (const team of Object.values(teamsDb)) {
            for (const player of team.roster) {
                if (!player.gameName || player.trackStats === false) continue;
                const riotAccount = await riotApi.getPUUID(player.gameName, player.tagLine);
                if (riotAccount && player.gameName !== riotAccount.gameName) {
                    player.gameName = riotAccount.gameName;
                    player.tagLine = riotAccount.tagLine;
                    player.puuid = riotAccount.puuid;
                    teamsUpdated = true;
                }
            }
        }

        // --- PHASE 2: EVENTS ---
        const scoutingData = await primeApi.fetchPrimeData(teamsDb);
        for (const match of scoutingData) await discord.syncMatchEvent(match);

        // --- PHASE 3: ANALYTICS ---
        const lpBoard = [], powerBoard = [];

        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            const teamNameShort = teamInfo.teamDisplay.replace("UIC ", "");

            await processInBatches(teamInfo.roster, 5, 1200, async (player) => {
                if (!player.puuid || player.trackStats === false) return;

                const rank = await riotApi.getRankedData(player.puuid);
                if (rank) lpBoard.push({ ...rank, gameName: player.gameName, team: teamNameShort });

                // SoloQ Logic
                const soloMatchIds = await riotApi.getRecentMatches(player.puuid, 5, 420);
                if (soloMatchIds?.length) {
                    const latestId = soloMatchIds[0];
                    const cache = playerState[player.puuid] || { primeHistory: [] };

                    if (cache.lastSoloId === latestId) {
                        powerBoard.push({ ...cache.lastScores, gameName: player.gameName, team: teamNameShort });
                    } else {
                        const mData = await riotApi.getMatchData(latestId);
                        const tLine = await riotApi.getMatchTimeline(latestId);
                        const scores = analytics.calculateIndices(player.puuid, mData, tLine, player.role);
                        if (scores) {
                            powerBoard.push({ ...scores, gameName: player.gameName, team: teamNameShort });
                            playerState[player.puuid] = { ...cache, lastSoloId: latestId, lastScores: scores };
                            stateUpdated = true;
                        }
                    }
                }

                // Prime Match Logic (The Website Source)
                const activeMatch = scoutingData.find(m => m.myTeam === teamKey);
                if (activeMatch) {
                    const customIds = await riotApi.getRecentMatches(player.puuid, 3, 'custom');
                    for (const cid of customIds) {
                        const matchFile = path.join(MATCHES_DIR, `match_${cid}.json`);
                        if (fs.existsSync(matchFile)) continue;

                        const cMatch = await riotApi.getMatchData(cid);
                        const diffHours = Math.abs(new Date(cMatch.info.gameCreation) - new Date(activeMatch.matchTime)) / 36e5;

                        if (diffHours < 2.5) {
                            const cTimeline = await riotApi.getMatchTimeline(cid);
                            const forensic = analytics.calculateWebsiteLedger(player.puuid, cMatch, cTimeline, player.role);
                            
                            if (forensic) {
                                // Track Season Average for Website Visualization
                                const cache = playerState[player.puuid] || { primeHistory: [] };
                                cache.primeHistory = cache.primeHistory || [];
                                cache.primeHistory.push(forensic.indices);
                                
                                const avg = (key) => Math.round(cache.primeHistory.reduce((s, h) => s + h[key], 0) / cache.primeHistory.length);
                                forensic.season_avg = { ci: avg('ci'), ti: avg('ti'), vi: avg('vi') };

                                fs.writeFileSync(matchFile, JSON.stringify(forensic, null, 2));
                                await discord.postMatchSummary({ teamName: teamNameShort, enemyName: activeMatch.enemyTeamName, win: forensic.win, players: [forensic] });
                                stateUpdated = true;
                            }
                        }
                    }
                }
            });
        }

        if (lpBoard.length) await discord.updateLpLeaderboard(lpBoard);
        if (powerBoard.length) await discord.updatePowerRankings(powerBoard);

        if (teamsUpdated) fs.writeFileSync(TEAMS_PATH, JSON.stringify(teamsDb, null, 2));
        if (stateUpdated) fs.writeFileSync(STATE_PATH, JSON.stringify(playerState, null, 2));
    } catch (e) { console.error(e); }
}
runEngine();
