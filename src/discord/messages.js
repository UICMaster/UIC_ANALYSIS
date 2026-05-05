/**
 * src/discord/messages.js
 * Formats and delivers the analytical leaderboards to Discord.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const CH_LP = process.env.DISCORD_CH_LP;
const CH_CARRY = process.env.DISCORD_CH_CARRY;
const CH_TACTICIAN = process.env.DISCORD_CH_TACTICIAN;

const API_BASE = 'https://discord.com/api/v10';
const UIC_COLOR = 0x00F0FF; // The #00F0FF Cyan Color

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
    "UNRANKED": "<:unranked:1501325256227553362> "
};

async function discordFetch(endpoint, method = 'GET', body = null) {
    if (!BOT_TOKEN) return null;
    const options = { method, headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        if (response.status === 429) {
            const errorData = await response.json();
            await new Promise(res => setTimeout(res, errorData.retry_after * 1000));
            return discordFetch(endpoint, method, body);
        }
        if (!response.ok) return null;
        return response.status === 204 ? true : await response.json();
    } catch (error) {
        return null;
    }
}

async function clearChannel(channelId) {
    if (!channelId) return;
    const messages = await discordFetch(`/channels/${channelId}/messages?limit=10`);
    if (messages && messages.length > 0) {
        for (const msg of messages) {
            await discordFetch(`/channels/${channelId}/messages/${msg.id}`, 'DELETE');
        }
    }
}

async function postEmbed(channelId, title, description) {
    if (!channelId) return;
    await clearChannel(channelId);
    
    const payload = {
        embeds: [{
            title: title,
            description: description,
            color: UIC_COLOR,
            footer: { text: "Bereitgestellt durch Ultra Instinct Crew" },
            timestamp: new Date().toISOString()
        }]
    };
    await discordFetch(`/channels/${channelId}/messages`, 'POST', payload);
}

// --- LEADERBOARD LOGIC ---

// Helper to mathematically sort League of Legends Ranks
function getRankScore(tier, rank, lp) {
    const tiers = { "CHALLENGER": 90000, "GRANDMASTER": 80000, "MASTER": 70000, "DIAMOND": 60000, "EMERALD": 50000, "PLATINUM": 40000, "GOLD": 30000, "SILVER": 20000, "BRONZE": 10000, "IRON": 0 };
    const ranks = { "I": 4000, "II": 3000, "III": 2000, "IV": 1000 };
    return (tiers[tier] || 0) + (ranks[rank] || 0) + parseInt(lp || 0);
}

async function updateLpLeaderboard(data) {
    if (!data || data.length === 0) return;

    data.sort((a, b) => getRankScore(b.tier, b.rank, b.lp) - getRankScore(a.tier, a.rank, a.lp));
    
    // We use \u2003 (Em Space) to act as a wide, clean tab stop
    const description = data.slice(0, 15).map((p, index) => {
        const emoji = RANK_EMOJIS[p.tier] || RANK_EMOJIS["UNRANKED"];
        return `**${index + 1}.** **${p.gameName}** ${emoji} ${p.tier} ${p.rank} (${p.lp} LP)`;
    }).join('\n\n');

    await postEmbed(CH_LP, "🏆 UIC Rangliste SoloQ/DuoQ", description);
    console.log(`   ✅ [Discord] Posted 🏆 UIC Rangliste SoloQ/DuoQ`);
}

async function updateCarryIndex(data) {
    if (!data || data.length === 0) return;

    data.sort((a, b) => b.gd15 - a.gd15);
    
    const description = data.slice(0, 10).map((p, index) => {
        return `**${index + 1}.** **${p.gameName}** 📈 +${p.gd15} GD15 | ⚔️ ${p.dmgPerGold} DPG`;
    }).join('\n\n');

    await postEmbed(CH_CARRY, "⚔️ UIC Rangliste Carry Index", description);
    console.log(`   ✅ [Discord] Posted ⚔️ UIC Rangliste Carry Index`);
}

async function updateTacticianLedger(data) {
    if (!data || data.length === 0) return;

    data.sort((a, b) => b.kp - a.kp);
    
    const description = data.slice(0, 10).map((p, index) => {
        return `**${index + 1}.** **${p.gameName}** 🎯 ${p.kp}% KP | 👁️ ${p.vspm} VSPM`;
    }).join('\n\n');

    await postEmbed(CH_TACTICIAN, "🧠 UIC Rangliste Tactician Index", description);
    console.log(`   ✅ [Discord] Posted 🧠 UIC Rangliste Tactician Index`);
}

module.exports = { updateLpLeaderboard, updateCarryIndex, updateTacticianLedger };
