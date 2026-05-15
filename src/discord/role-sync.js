/**
 * src/discord/role-sync.js
 * Synchronizes Discord Roles based on Riot Games Ranked Tiers.
 * Respects the Golden teams.json structure.
 */
const fs = require('fs');

// --- 1. CONFIGURATION & SECRETS ---
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN || !GUILD_ID) {
    console.error("❌ CRITICAL: Discord Token or Guild ID is missing from .env");
    process.exit(1);
}

// ⚠️ YOUR ACTUAL DISCORD ROLE IDs
const RANK_ROLES = {
    "CHALLENGER": "1358901521990942771",
    "GRANDMASTER": "1358901520887713883",
    "MASTER": "1358901519566504068",
    "DIAMOND": "1358901518820053204",
    "EMERALD": "1358901517964284015",
    "PLATINUM": "1358901517028954413",
    "GOLD": "1358901516118786108",
    "SILVER": "1358901515099701289",
    "BRONZE": "1358901513942204416",
    "IRON": "1358901512994164978",
    "UNRANKED": "1504828753459675166" 
};

const ALL_RANK_ROLE_IDS = Object.values(RANK_ROLES);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- 2. BULLETPROOF DISCORD API WRAPPER ---
async function discordRequest(endpoint, method = 'GET', body = null) {
    const url = `https://discord.com/api/v10${endpoint}`;
    const res = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bot ${DISCORD_TOKEN}`,
            'Content-Type': 'application/json',
            'User-Agent': 'UIC-Analytics-Bot (https://github.com/uic, 1.0.0)'
        },
        body: body ? JSON.stringify(body) : null
    });

    if (res.status === 429) {
        const data = await res.json();
        const delay = (data.retry_after * 1000) + 100;
        console.warn(`⚠️ [Discord] Rate limited. Sleeping for ${delay}ms...`);
        await sleep(delay);
        return discordRequest(endpoint, method, body);
    }

    if (!res.ok) {
        if (res.status === 404) throw new Error("404_UNKNOWN_MEMBER");
        if (res.status === 403) throw new Error("403_FORBIDDEN_HIERARCHY");
        throw new Error(`Discord API Error ${res.status}: ${res.statusText}`);
    }
    return res.status === 204 ? true : await res.json();
}

// --- 3. THE CORE SYNC LOGIC ---
async function syncUser(player, currentTier) {
    const discordId = player.discordId;
    const targetRoleId = RANK_ROLES[currentTier?.toUpperCase()] || RANK_ROLES["UNRANKED"];

    try {
        // Step 1: Get user's current roles
        const member = await discordRequest(`/guilds/${GUILD_ID}/members/${discordId}`);
        const currentRoles = member.roles || [];

        // Step 2: Calculate the Diff
        const hasCorrectRole = currentRoles.includes(targetRoleId);
        const otherRankRoles = currentRoles.filter(r => ALL_RANK_ROLE_IDS.includes(r) && r !== targetRoleId);

        if (hasCorrectRole && otherRankRoles.length === 0) {
            console.log(`✅ [OK] ${player.gameName || 'User'} is already synced to ${currentTier || 'UNRANKED'}.`);
            return;
        }

        // Step 3: Add the correct role
        if (!hasCorrectRole) {
            // Uncomment the line below to perform the actual assignment
            await discordRequest(`/guilds/${GUILD_ID}/members/${discordId}/roles/${targetRoleId}`, 'PUT');
            console.log(`🆙 [Updated] ${player.gameName || 'User'}: Granted ${currentTier || 'UNRANKED'} role.`);
            await sleep(500);
        }

        // Step 4: Strip the incorrect/old roles
        for (const oldRole of otherRankRoles) {
            // Uncomment the line below to perform the actual removal
            await discordRequest(`/guilds/${GUILD_ID}/members/${discordId}/roles/${oldRole}`, 'DELETE');
            console.log(`🧹 [Cleaned] ${player.gameName || 'User'}: Removed outdated rank role.`);
            await sleep(500);
        }
    } catch (e) {
        if (e.message === "404_UNKNOWN_MEMBER") {
            console.log(`👻 [Ghost] ${player.gameName || 'User'} (ID: ${discordId}) is not in the Discord server.`);
        } else if (e.message === "403_FORBIDDEN_HIERARCHY") {
            console.error(`🚨 [Permission Error] Cannot assign role to ${player.gameName || 'User'}. Move the Bot's role HIGHER in Server Settings!`);
        } else {
            console.error(`❌ [Error] Failed to sync ${player.gameName || 'User'}:`, e.message);
        }
    }
}

// --- 4. EXECUTION FLOW ---
async function startSync() {
    console.log("🚀 Starting Discord Role Sync...");

    const teamsPath = './data/teams.json';
    const statePath = './data/player_state.json';

    if (!fs.existsSync(teamsPath) || !fs.existsSync(statePath)) {
        console.error("❌ CRITICAL: teams.json or player_state.json is missing.");
        process.exit(1);
    }

    const teams = JSON.parse(fs.readFileSync(teamsPath, 'utf8'));
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    for (const teamKey in teams) {
        const team = teams[teamKey];
        console.log(`📡 Syncing Roles for: ${team.teamDisplay}`);

        for (const player of team.roster) {
            // --- THE RESPECTFUL CHECKS ---
            if (!player.trackStats) {
                console.log(`⏭️  Skipping ${player.gameName || 'Empty Slot'} (trackStats: false)`);
                continue;
            }

            if (!player.discordId) {
                console.log(`⏭️  Skipping ${player.gameName} (No DiscordID)`);
                continue;
            }

            const playerState = state[player.puuid];
            const tier = playerState ? playerState.tier : "UNRANKED";

            await syncUser(player, tier);
            await sleep(1000); // Respect Discord's rate limits (1 member per second)
        }
    }
    console.log("🎉 Discord Role Sync Complete!");
}

startSync();
