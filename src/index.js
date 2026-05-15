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
const discordRoles = require('./discord/roles'); // <--- 1. NEW IMPORT

const TEAMS_PATH = path.join(__dirname, '../data/teams.json');
const LEDGER_PATH = path.join(__dirname, '../data/match_database.json');
const STATE_PATH = path.join(__dirname, '../data/player_state.json');

async function runEngine() {
    console.log("🚀 Starting UIC Analytics Modular Engine...");

    try {
        // ... existing DB loading logic ...

        // --- PHASE 1: PUUID & NAME SYNCHRONIZATION ---
        // ... existing Phase 1 loop ...

        // --- PHASE 2: PRIME MATCHUPS ---
        // ... existing Phase 2 logic ...

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

                // Fetch rank from Riot
                const rankData = await riotApi.getRankedData(player.puuid);

                // 🚀 2. DISCORD ROLE SYNC HOOK 🚀
                if (player.discordId && player.discordId !== "") {
                    await discordRoles.syncPlayerRank(player, rankData ? rankData.tier : "UNRANKED");
                }

                if (rankData) {
                    discordLpBoard.push({ gameName: player.gameName, tagLine: player.tagLine, team: teamNameShort, tier: rankData.tier, rank: rankData.rank, lp: rankData.lp });
                    if (player.role !== "MNG" && player.role !== "COH") currentTeamData.activeRanks.push(rankData);
                }

                // ... existing match detection and ledger logic continues below unchanged ...
