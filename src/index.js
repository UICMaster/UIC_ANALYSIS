/**
 * src/index.js
 * The Master Orchestrator for the UIC Analytics Engine.
 * Pure SoloQ, Discord Integration, & Roster Export Build.
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

async function runEngine() {
    console.log("🚀 Starting UIC Analytics SoloQ Engine...");

    try {
        const teamsDb = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf8'));
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

        console.log("\n🧠 --- PHASE 2: SOLOQ DATA ACQUISITION & EXPORT ---");
        
        const currentPatch = await riotApi.getLatestPatch();
        console.log(`   ✨ Using Data Dragon Patch: ${currentPatch}`);

        let discordLpBoard = [];
        let discordMasterBoard = []; 
        let teamOverviewData = []; 
        let exportData = {}; 

        for (const [teamKey, teamInfo] of Object.entries(teamsDb)) {
            
            // DYNAMIC EXPORT RULE: If a team has a Prime League ID, they go to the Website Export
            const isExportTeam = teamInfo.primeLeagueId && teamInfo.primeLeagueId.trim() !== "";
            if (isExportTeam) exportData[teamKey] = [];

            console.log(`\n🛡️ Processing Group: ${teamInfo.teamDisplay}`);
            let currentTeamData = { teamDisplay: teamInfo.teamDisplay, roster: [], activeRanks: [] };

            for (let player of teamInfo.roster) {
                
                // --- EXPORT GATE 1: Handle Empty Slots or Ignored Profiles ---
                if (player.trackStats === false || !player.gameName || player.gameName.trim() === "") {
                    if (isExportTeam) {
                        exportData[teamKey].push({
                            name: player.gameName || "OPEN SPOT",
                            role: player.role,
                            level: 0,
                            tier: player.gameName ? "STAFF" : "RECRUITING",
                            lp: 0, wins: 0, losses: 0, winRate: 0, icon: null
                        });
                    }
                    continue; 
                }

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

                currentTeamData.roster.push({ gameName: player.gameName, tagLine: player.tagLine, role: player.role, isCaptain: player.isCaptain, rankData: rankData, rosterStatus: player.rosterStatus });

                // --- EXPORT GATE 2: Build Website Database (MNG & COH are captured here!) ---
                if (isExportTeam) {
                    const summonerData = await riotApi.getSummonerData(player.puuid);
                    let winRate = 0;
                    if (rankData && (rankData.wins + rankData.losses) > 0) {
                        winRate = parseFloat(((rankData.wins / (rankData.wins + rankData.losses)) * 100).toFixed(1));
                    }
                    
                    exportData[teamKey].push({
                        name: player.gameName,
                        role: player.role,
                        level: summonerData ? summonerData.summonerLevel : 0,
                        tier: rankData ? `${rankData.tier} ${rankData.rank}` : "UNRANKED",
                        lp: rankData ? rankData.lp : 0,
                        wins: rankData ? rankData.wins : 0,
                        losses: rankData ? rankData.losses : 0,
                        winRate: winRate,
                        icon: summonerData ? `https://ddragon.leagueoflegends.com/cdn/${currentPatch}/img/profileicon/${summonerData.profileIconId}.png` : null
                    });
                }

                // 🛑 THE STAFF GATE: Hard Stop for Managers and Coaches.
                // They are officially saved to data.json above, so we safely skip their Match History loop here.
                if (player.role === "MNG" || player.role === "COH") continue;

                // 3. Match Processing (Only Active Roster & Subs reach this point)
                const matchIds = await riotApi.getRecentMatches(player.puuid, 20);
                const latestMatchId = matchIds.length > 0 ? matchIds[0] : "no_games";

                if (!matchIds || matchIds.length === 0) continue;

                const cachedState = playerState[player.puuid];

                if (cachedState && cachedState.lastMatchId === latestMatchId) {
                    console.log(`   ⏭️ Skipped Riot Fetch for ${player.gameName} (No new games)`);
                    if (cachedState.ovr) {
                        discordMasterBoard.push({ gameName: player.gameName, tagLine: player.tagLine, team: teamNameShort, metrics: cachedState });
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
                }

                // Calculate OVR based on SoloQ games
                const metrics = analytics.calculateDiscordStats(player.puuid, matchDatas, timelineDatas, player.role);
                
                // Save Cache State
                playerState[player.puuid] = playerState[player.puuid] || {};
                playerState[player.puuid].lastMatchId = latestMatchId;

                if (metrics) {
                    discordMasterBoard.push({ gameName: player.gameName, tagLine: player.tagLine, team: teamNameShort, metrics: metrics });
                    Object.assign(playerState[player.puuid], metrics);
                }
                
                cacheUpdated = true;
            }
            teamOverviewData.push(currentTeamData);
        }

        console.log("\n📊 --- PHASE 3: DISCORD DELIVERY ---");
        if (discordLpBoard.length > 0) await discordMessages.updateLpLeaderboard(discordLpBoard);
        if (discordMasterBoard.length > 0) await discordMessages.updateMasterLeaderboard(discordMasterBoard);
        if (teamOverviewData.length > 0) await discordMessages.updateTeamOverview(teamOverviewData);

        console.log("\n💾 --- PHASE 4: SAVING DATA ---");
        if (teamsUpdated) {
            fs.writeFileSync(TEAMS_PATH, JSON.stringify(teamsDb, null, 2));
            console.log("   ✅ teams.json updated with Live Account Data.");
        }

        if (cacheUpdated) {
            fs.writeFileSync(STATE_PATH, JSON.stringify(playerState, null, 2));
            console.log("   ✅ player_state.json cache updated.");
        }

        // Save generated Website Export Database
        fs.writeFileSync(EXPORT_PATH, JSON.stringify(exportData, null, 2));
        console.log("   ✅ data.json (Website Export) generated safely.");

        console.log("\n🎉 Engine Run Complete! All systems nominal.");
    } catch (error) {
        console.error("\n❌ Fatal Engine Error:", error);
    }
}

runEngine();
