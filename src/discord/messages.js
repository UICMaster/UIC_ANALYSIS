/**
 * src/discord/messages.js
 * Formats and delivers the analytical leaderboards and match summaries.
 */

const { fetchWithRetry } = require('../utils/network');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE = 'https://discord.com/api/v10';
const UIC_COLOR = 0x00F0FF;

const CH_LP = process.env.DISCORD_CH_LP;
const CH_POWER = process.env.DISCORD_CH_POWER_RANKINGS;
const CH_RESULTS = process.env.DISCORD_CH_RESULTS;

/**
 * Internal Discord API Fetcher
 */
async function discordFetch(endpoint, method = 'GET', body = null) {
    const url = `${API_BASE}${endpoint}`;
    const options = {
        method,
        headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    const { data } = await fetchWithRetry(url, options);
    return data;
}

/**
 * Manages message persistence to avoid spamming the channel.
 */
async function updateOrPostMessage(channelId, embeds) {
    if (!channelId || !embeds.length) return;

    const messages = await discordFetch(`/channels/${channelId}/messages?limit=50`) || [];
    const botMessages = messages.filter(m => m.author.bot).sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < embeds.length; i++) {
        const payload = { embeds: [embeds[i]] };
        if (i < botMessages.length) {
            await discordFetch(`/channels/${channelId}/messages/${botMessages[i].id}`, 'PATCH', payload);
        } else {
            await discordFetch(`/channels/${channelId}/messages`, 'POST', payload);
        }
    }
}

/**
 * SOLOQ POWER RANKINGS: Combined performance leaderboard
 */
async function updatePowerRankings(data) {
    if (!CH_POWER || !data.length) return;
    
    // Sort by combined score
    data.sort((a, b) => (b.ci + b.ti + b.vi) - (a.ci + a.ti + a.vi));

    const embed = {
        title: "📈 UIC Performance Index (SoloQ)",
        description: "Normalisiert gegen Master+ Baseline (50).",
        color: 0xFFAA00,
        fields: data.slice(0, 15).map((p, i) => ({
            name: `${i + 1}. ${p.gameName} (${p.team})`,
            value: `**Carry:** ${p.ci} | **Tact:** ${p.ti} | **Vanguard:** ${p.vi}`,
            inline: false
        })),
        timestamp: new Date().toISOString()
    };

    await updateOrPostMessage(CH_POWER, [embed]);
}

/**
 * PRIME MATCH SUMMARY: Hype for the results channel
 */
async function postMatchSummary(res) {
    if (!CH_RESULTS) return;

    const embed = {
        title: `${res.win ? '✅' : '❌'} Match: UIC ${res.teamName} vs ${res.enemyName}`,
        color: res.win ? 0x00FF00 : 0xFF0000,
        fields: res.players.map(p => ({
            name: `${p.role}: ${p.gameName}`,
            value: `**CI:** ${p.indices.ci} | **TI:** ${p.indices.ti} | **VI:** ${p.indices.vi} (${p.champion})`,
            inline: true
        })),
        footer: { text: "Details & Season History auf der Website." }
    };

    await discordFetch(`/channels/${CH_RESULTS}/messages`, 'POST', { embeds: [embed] });
}

/**
 * LP LADDER: Pure Rank Helper & Update
 */
const getRankScore = (p) => {
    const tiers = { "CHALLENGER": 90000, "GRANDMASTER": 80000, "MASTER": 70000, "DIAMOND": 60000, "EMERALD": 50000, "PLATINUM": 40000, "GOLD": 30000, "SILVER": 20000, "BRONZE": 10000, "IRON": 0 };
    const divisions = { "I": 4000, "II": 3000, "III": 2000, "IV": 1000 };
    return (tiers[p.tier] || 0) + (divisions[p.rank] || 0) + (p.lp || 0);
};

async function updateLpLeaderboard(data) {
    if (!CH_LP || !data.length) return;
    data.sort((a, b) => getRankScore(b) - getRankScore(a));

    const embed = {
        title: "🏆 UIC SoloQ Ladder",
        color: UIC_COLOR,
        fields: [
            { name: "Spieler", value: data.map((p, i) => `**${i + 1}.** ${p.gameName} *(${p.team})*`).join('\n'), inline: true },
            { name: "Rang & LP", value: data.map(p => `${p.tier} ${p.rank} (${p.lp} LP)`).join('\n'), inline: true }
        ],
        timestamp: new Date().toISOString()
    };
    await updateOrPostMessage(CH_LP, [embed]);
}

module.exports = { 
    updateLpLeaderboard, 
    updatePowerRankings, 
    postMatchSummary, 
    syncMatchEvent: require('./events').syncMatchEvent 
};
