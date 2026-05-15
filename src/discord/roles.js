/**
 * src/discord/roles.js
 * Logic for synchronizing Discord roles based on Riot Tiers.
 */

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

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

async function discordRequest(endpoint, method = 'GET', body = null) {
    const url = `https://discord.com/api/v10${endpoint}`;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bot ${DISCORD_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'UIC-Analytics-Bot (1.0.0)'
            },
            body: body ? JSON.stringify(body) : null
        });

        if (res.status === 429) {
            const data = await res.json();
            const retry = (data.retry_after || 5) * 1000;
            await sleep(retry + 100);
            return discordRequest(endpoint, method, body);
        }
        return res.status === 204 ? true : await res.json();
    } catch (e) {
        return null;
    }
}

async function syncPlayerRank(player, tier) {
    if (!player.discordId || player.discordId === "") return;
    
    const targetTier = tier ? tier.toUpperCase() : "UNRANKED";
    const targetRoleId = RANK_ROLES[targetTier];
    if (!targetRoleId) return;

    try {
        const member = await discordRequest(`/guilds/${GUILD_ID}/members/${player.discordId}`);
        if (!member || !member.roles) return;

        const currentRoles = member.roles;
        const hasCorrectRole = currentRoles.includes(targetRoleId);
        const otherRankRoles = currentRoles.filter(r => ALL_RANK_ROLE_IDS.includes(r) && r !== targetRoleId);

        // If user has the right role and no old rank roles, we are done.
        if (hasCorrectRole && otherRankRoles.length === 0) return;

        // 1. Assign new role
        if (!hasCorrectRole) {
            await discordRequest(`/guilds/${GUILD_ID}/members/${player.discordId}/roles/${targetRoleId}`, 'PUT');
            console.log(`   🎭 [Discord] Assigned ${targetTier} to ${player.gameName}`);
            await sleep(250); 
        }

        // 2. Strip all other old rank roles
        for (const oldRole of otherRankRoles) {
            await discordRequest(`/guilds/${GUILD_ID}/members/${player.discordId}/roles/${oldRole}`, 'DELETE');
            console.log(`   🧹 [Discord] Cleaned old rank role from ${player.gameName}`);
            await sleep(250);
        }
    } catch (e) {
        // Silently catch ghost members who left the server
    }
}

module.exports = { syncPlayerRank };
