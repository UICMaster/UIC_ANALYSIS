/**
 * src/discord/messages.js
 * Formats and delivers the analytical leaderboards to Discord via Smart Editing.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE = 'https://discord.com/api/v10';

const CH_LP = process.env.DISCORD_CH_LP;
const CH_CARRY = process.env.DISCORD_CH_CARRY;
const CH_TACTICIAN = process.env.DISCORD_CH_TACTICIAN;
const CH_OVERVIEW = process.env.DISCORD_CH_OVERVIEW;

const UIC_COLOR = 0x00F0FF; // #00F0FF Cyan Color

// Custom Server Emojis
const RANK_EMOJIS = {
    "CHALLENGER": "<:challenger:1501324978321101021>",
    "GRANDMASTER": "<:grandmaster:1501325107128434748>",
    "MASTER": "<:master:1501325178993512478>",
    "DIAMOND": "<:diamond:1501325003671601224>",
    "EMERALD": "<:emerald:1501325048219304039>",
    "PLATINUM": "<:platinum:1501325207330095104>",
    "GOLD": "<:gold:1501325080960172072>",
    "SILVER": "<:silver:1501325230868529345>",
    "BRONZE": "<:bronze:1501324928606146761>",
    "IRON": "<:iron:1501325151466422282>",
    "UNRANKED": "<:unranked:1501325256227553362>"
};

async function discordFetch(endpoint, method = 'GET', body = null) {
    if (!BOT_TOKEN) return null;
    const options = { method, headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        if (response.status === 429) {
            const errorData = await response.json();
            console.warn(`⚠️ [Discord] Rate limited. Waiting ${errorData.retry_after}s...`);
            await new Promise(res => setTimeout(res, errorData.retry_after * 1000));
            return discordFetch(endpoint, method, body);
        }
        if (!response.ok) return null;
        return response.status === 204 ? true : await response.json();
    } catch (error) {
        console.error(`❌ [Discord API] Error on ${endpoint}:`, error.message);
        return null;
    }
}

/**
 * 🚀 THE SMART EDIT ALGORITHM 🚀
 * Instead of deleting messages, we update existing ones.
 */
async function updateOrPostMessage(channelId, embeds) {
    if (!channelId || embeds.length === 0) return;

    // Discord allows max 10 embeds per message. We chunk them.
    const embedChunks = [];
    for (let i = 0; i < embeds.length; i += 10) {
        embedChunks.push(embeds.slice(i, i + 10));
    }

    // Grab the last 10 messages in the channel
    const messages = await discordFetch(`/channels/${channelId}/messages?limit=10`);
    const botMessages = messages ? messages.filter(m => m.author.bot) : [];

    // Sort oldest to newest to maintain order
    botMessages.sort((a, b) => a.id.localeCompare(b.id));

    // Update existing messages, or create new ones if we need more chunks
    for (let i = 0; i < embedChunks.length; i++) {
        const payload = { embeds: embedChunks[i] };
        if (i < botMessages.length) {
            await discordFetch(`/channels/${channelId}/messages/${botMessages[i].id}`, 'PATCH', payload);
        } else {
            await discordFetch(`/channels/${channelId}/messages`, 'POST', payload);
        }
    }

    // Clean up excess bot messages (e.g. if roster shrank and we need fewer messages)
    for (let i = embedChunks.length; i < botMessages.length; i++) {
        await discordFetch(`/channels/${channelId}/messages/${botMessages[i].id}`, 'DELETE');
    }
}

/**
 * The Master Leaderboard Generator
 */
async function postLeaderboard(channelId, title, leftHeader, rightHeader, players, formatCallback) {
    if (!channelId) return;

    const validPlayers = players.filter(p => p !== null);
    let embeds = [];
    
    // Chunking to stay under the 1024 character limit per embed field
    const chunkSize = 15; 

    for (let i = 0; i < validPlayers.length; i += chunkSize) {
        const chunk = validPlayers.slice(i, i + chunkSize);
        
        let columnLeft = "";
        let columnRight = "";

        chunk.forEach((player, index) => {
            const overallRank = i + index + 1;
            const formatted = formatCallback(player, overallRank);
            
            columnLeft += formatted.left + "\n";
            columnRight += formatted.right + "\n";
        });

        embeds.push({
            title: i === 0 ? title : `${title} (Fortsetzung)`,
            color: UIC_COLOR,
            fields: [
                { name: leftHeader, value: columnLeft || "-", inline: true },
                { name: rightHeader, value: columnRight || "-", inline: true }
            ],
            footer: i === 0 ? { text: "Bereitgestellt durch Ultra Instinct Crew" } : null,
            timestamp: i === 0 ? new Date().toISOString() : null // Adds a "Last Updated" timestamp
        });
    }

    await updateOrPostMessage(channelId, embeds);
    console.log(`   ✅ [Discord] Updated ${title}`);
}

// --- SCORE MATH & AVERAGES ---
function getRankScore(tier, rank, lp) {
    const tiers = { "CHALLENGER": 90000, "GRANDMASTER": 80000, "MASTER": 70000, "DIAMOND": 60000, "EMERALD": 50000, "PLATINUM": 40000, "GOLD": 30000, "SILVER": 20000, "BRONZE": 10000, "IRON": 0, "UNRANKED": 0 };
    const ranks = { "I": 4000, "II": 3000, "III": 2000, "IV": 1000 };
    return (tiers[tier] || 0) + (ranks[rank] || 0) + parseInt(lp || 0);
}

// --- UPDATERS ---
async function updateLpLeaderboard(data) {
    if (!data || data.length === 0) return;
    data.sort((a, b) => getRankScore(b.tier, b.rank, b.lp) - getRankScore(a.tier, a.rank, a.lp));
    
    await postLeaderboard(CH_LP, "UIC Rangliste SoloQ/DuoQ", "Spieler", "Rang & LP", data, (p, rank) => {
        const emoji = RANK_EMOJIS[p.tier] || RANK_EMOJIS["UNRANKED"];
        return {
            left: `**${rank}.** ${p.gameName} *(${p.team})*`,
            right: `${emoji} ${p.tier} ${p.rank} (${p.lp} LP)`
        };
    });
}

async function updateCarryIndex(data) {
    if (!data || data.length === 0) return;
    data.sort((a, b) => b.carryIndex - a.carryIndex); 
    
    await postLeaderboard(CH_CARRY, "UIC Rangliste Carry Index", "Spieler", "Wertung", data, (p, rank) => {
        return {
            left: `**${rank}.** ${p.gameName} *(${p.team})*`,
            right: `Score: **${p.carryIndex}**`
        };
    });
}

async function updateTacticianLedger(data) {
    if (!data || data.length === 0) return;
    data.sort((a, b) => b.tacticianIndex - a.tacticianIndex); 
    
    await postLeaderboard(CH_TACTICIAN, "UIC Rangliste Tactician Index", "Spieler", "Wertung", data, (p, rank) => {
        return {
            left: `**${rank}.** ${p.gameName} *(${p.team})*`,
            right: `Score: **${p.tacticianIndex}**`
        };
    });
}

async function updateTeamOverview(teamOverviewData) {
    if (!CH_OVERVIEW || teamOverviewData.length === 0) return;

    const roleMapping = {
        "TOP": "Toplane", 
        "JGL": "Jungle", 
        "MID": "Midlane", 
        "BOT": "Botlane", 
        "SUP": "Support", 
        "MNG": "Manager", 
        "COH": "Coach"
    };

    let embeds = [];

    for (const team of teamOverviewData) {
        let nameColumn = "";
        let roleColumn = "";

        team.roster.forEach(p => {
            const tag = p.tagLine && p.tagLine !== "undefined" ? `#${p.tagLine}` : "";
            const crown = p.isCaptain ? " 👑" : "";
            
            // Format Names and mapped Roles cleanly
            nameColumn += `${p.gameName}${tag}${crown}\n`;
            
            // If it's a sub, add it next to the role. E.g., "Midlane (Sub)"
            const subLabel = p.rosterStatus === "substitute" ? " *(Sub)*" : "";
            roleColumn += `${roleMapping[p.role] || p.role}${subLabel}\n`; 
        });

        embeds.push({
            title: team.teamDisplay,
            color: UIC_COLOR,
            fields: [
                { name: "Kader", value: nameColumn || "-", inline: true },
                { name: "Rolle", value: roleColumn || "-", inline: true }
            ]
        });
    }

    await updateOrPostMessage(CH_OVERVIEW, embeds);
    console.log(`   ✅ [Discord] Updated Team Overview`);
}

module.exports = { updateLpLeaderboard, updateCarryIndex, updateTacticianLedger, updateTeamOverview };
