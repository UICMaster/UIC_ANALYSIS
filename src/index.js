/**
 * src/index.js
 * The Master Orchestrator for the UIC Analytics Engine.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const riotApi = require('./api/riot');
const analytics = require('./core/analytics');
const discordMessages = require('./discord/messages');
const discordRoles = require('./discord/roles'); 

const TEAMS_PATH = path.join(__dirname, '../data/teams.json');
const STATE_PATH = path.join(__dirname, '../data/player_state.json');
const EXPORT_PATH = path.join(__dirname, '../data/data.json');

function safeSaveJson(filePath, data) {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filePath);
}

async function runEngine() {
    console.log("🚀 Starting UIC Analytics SoloQ Engine...");

    try {
        const teamsDb = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
        let playerState = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};

        let teamsUpdated = false;
        let cacheUpdated = false;

        console.log("\n🔍 --- PHASE 1: PUUID & NAME SYNCHRONIZATION ---");
        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            const roster = Array.isArray(teamInfo.roster) ? teamInfo.roster : []; 
            for (let player of roster) {
                if (player.trackStats === false) continue;

                if (!player.puuid || player.puuid === "") {
                    if (!player.gameName || player.gameName.trim() === "") continue;
                    console.log(`   📡 Fetching PUUID for ${player.gameName}...`);
                    const puuid = await riotApi.getPUUID(player.gameName, player.tagLine);
                    if (puuid) {
                        player.puuid = puuid;
                        teamsUpdated = true;
                    }
                } else {
                    const liveAccount = await riotApi.getAccountByPUUID(player.puuid);
                    if (liveAccount && liveAccount.gameName) {
                        if (player.gameName !== liveAccount.gameName || player.tagLine !== liveAccount.tagLine) {
                            player.gameName = liveAccount.gameName;
                            player.tagLine = liveAccount.tagLine;
                            teamsUpdated = true;
                        }
                    }
                }
            }
        }

        console.log("\n🧠 --- PHASE 2: SOLOQ DATA ACQUISITION & EXPORT ---");
        
        const currentPatch = await riotApi.getLatestPatch();
        
        let discordLpBoard = [];
        let discordTeamStatsData = []; // NEW: Groups stats per team instead of a global leaderboard
        let teamOverviewData = []; 
        let exportData = {}; 

        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            const isExportTeam = teamInfo.primeLeagueId && teamInfo.primeLeagueId.trim() !== "";
            if (isExportTeam) exportData[teamKey] = [];

            console.log(`\n🛡️ Processing Group: ${teamInfo.teamDisplay}`);
            let currentTeamData = { teamDisplay: teamInfo.teamDisplay, roster: [], activeRanks: [] };
            
            // NEW: Prepare the payload for this specific team's stats
            let currentTeamStats = { teamDisplay: teamInfo.teamDisplay, players: [] };
            
            const roster = Array.isArray(teamInfo.roster) ? teamInfo.roster : [];

            for (let player of roster) {
                if (player.trackStats === false || !player.gameName || player.gameName.trim() === "") {
                    if (isExportTeam) {
                        exportData[teamKey].push({
                            playerId: player.playerId || "0000", name: player.gameName || "OPEN SPOT",
                            role: player.role, level: 0, tier: player.gameName ? "STAFF" : "RECRUITING",
                            lp: 0, wins: 0, losses: 0, winRate: 0, icon: null
                        });
                    }
                    continue; 
                }

                const teamNameShort = teamInfo.teamDisplay.replace("UIC ", ""); 
                const rankData = await riotApi.getRankedData(player.puuid);

                if (player.discordId && player.discordId !== "") {
                    await discordRoles.syncPlayerRank(player, rankData ? rankData.tier : "UNRANKED");
                }

                if (rankData) {
                    discordLpBoard.push({ gameName: player.gameName, tagLine: player.tagLine, team: teamNameShort, tier: rankData.tier, rank: rankData.rank, lp: rankData.lp });
                    if (player.role !== "MNG" && player.role !== "COH") currentTeamData.activeRanks.push(rankData);
                }

                currentTeamData.roster.push({ gameName: player.gameName, tagLine: player.tagLine, role: player.role, isCaptain: player.isCaptain, rankData: rankData, rosterStatus: player.rosterStatus, lolpros: player.lolpros });

                if (isExportTeam) {
                    const summonerData = await riotApi.getSummonerData(player.puuid);
                    let winRate = 0;
                    if (rankData && (rankData.wins + rankData.losses) > 0) {
                        winRate = parseFloat(((rankData.wins / (rankData.wins + rankData.losses)) * 100).toFixed(1));
                    }
                    exportData[teamKey].push({
                        playerId: player.playerId || "0000", name: player.gameName, role: player.role,
                        level: summonerData ? summonerData.summonerLevel : 0, tier: rankData ? `${rankData.tier} ${rankData.rank}` : "UNRANKED",
                        lp: rankData ? rankData.lp : 0, wins: rankData ? rankData.wins : 0, losses: rankData ? rankData.losses : 0,
                        winRate: winRate, icon: summonerData ? `https://ddragon.leagueoflegends.com/cdn/${currentPatch}/img/profileicon/${summonerData.profileIconId}.png` : null
                    });
                }

                if (player.role === "MNG" || player.role === "COH") continue;

                const matchIds = await riotApi.getRecentMatches(player.puuid, 20);
                if (!matchIds || matchIds.length === 0) continue;

                playerState[player.puuid] = playerState[player.puuid] || {};
                const cachedState = playerState[player.puuid];
                
                const cachedMatchIds = cachedState.processedMatches || [];
                const newMatchIds = matchIds.filter(id => !cachedMatchIds.includes(id));

                if (newMatchIds.length === 0) {
                    console.log(`   ⏭️ Skipped Riot Fetch for ${player.gameName} (No new games)`);
                    if (cachedState.gd15 !== undefined) {
                        // Push cached raw stats into the team dashboard array
                        currentTeamStats.players.push({ gameName: player.gameName, tagLine: player.tagLine, role: player.role, metrics: cachedState });
                    }
                    continue; 
                }

                console.log(`   🔄 Fetching ${newMatchIds.length} new match(es) for ${player.gameName}...`);
                let matchDatas = [];
                let timelineDatas = [];

                for (const matchId of newMatchIds) {
                    const matchData = await riotApi.getMatchData(matchId);
                    if (!matchData) continue;
                    
                    const timelineData = await riotApi.getMatchTimeline(matchId);
                    if (!timelineData) continue;

                    matchDatas.push(matchData);
                    timelineDatas.push(timelineData);
                }

                const metrics = analytics.calculateDiscordStats(player.puuid, matchDatas, timelineDatas, player.role, cachedState);
                
                if (metrics) {
                    // Push newly calculated raw stats into the team dashboard array
                    currentTeamStats.players.push({ gameName: player.gameName, tagLine: player.tagLine, role: player.role, metrics: metrics });
                    playerState[player.puuid].processedMatches = matchIds; 
                    Object.assign(playerState[player.puuid], metrics);
                }
                cacheUpdated = true;
            }
            
            // Add the team's dashboard to the array if it has players
            if (currentTeamStats.players.length > 0) {
                discordTeamStatsData.push(currentTeamStats);
            }
            teamOverviewData.push(currentTeamData);
        }

        console.log("\n📊 --- PHASE 3: DISCORD DELIVERY ---");
        if (discordLpBoard.length > 0) await discordMessages.updateLpLeaderboard(discordLpBoard);
        if (discordTeamStatsData.length > 0) await discordMessages.updateTeamStatsBoard(discordTeamStatsData);
        if (teamOverviewData.length > 0) await discordMessages.updateTeamOverview(teamOverviewData);

        console.log("\n💾 --- PHASE 4: SAVING DATA ---");
        if (teamsUpdated) safeSaveJson(TEAMS_PATH, teamsDb);
        if (cacheUpdated) safeSaveJson(STATE_PATH, playerState);
        safeSaveJson(EXPORT_PATH, exportData);
        
        console.log("\n🎉 Engine Run Complete! All systems nominal.");
    } catch (error) {
        console.error("\n❌ Fatal Engine Error:", error);
    }
}

runEngine();
