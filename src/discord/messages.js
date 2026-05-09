const { fetchWithRetry } = require('../utils/network');
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE = 'https://discord.com/api/v10';

const CH_LP = process.env.DISCORD_CH_LP;
const CH_POWER = process.env.DISCORD_CH_POWER_RANKINGS;
const CH_RESULTS = process.env.DISCORD_CH_RESULTS;

async function discordFetch(endpoint, method = 'GET', body = null) {
    const { data } = await fetchWithRetry(`${API_BASE}${endpoint}`, {
        method,
        headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : null
    });
    return data;
}

async function updateOrPostMessage(channelId, embeds) {
    if (!channelId) return;
    const messages = await discordFetch(`/channels/${channelId}/messages?limit=50`) || [];
    const botMsg = messages.filter(m => m.author.bot).sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < embeds.length; i++) {
        const p = { embeds: [embeds[i]] };
        if (i < botMsg.length) await discordFetch(`/channels/${channelId}/messages/${botMsg[i].id}`, 'PATCH', p);
        else await discordFetch(`/channels/${channelId}/messages`, 'POST', p);
    }
}

async function updatePowerRankings(data) {
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

async function postMatchSummary(res) {
    const embed = {
        title: `${res.win ? '✅' : '❌'} Match: UIC ${res.teamName} vs ${res.enemyName}`,
        color: res.win ? 0x00FF00 : 0xFF0000,
        fields: res.players.map(p => ({
            name: `${p.role}: ${p.gameName}`,
            value: `**CI:** ${p.indices.ci} | **TI:** ${p.indices.ti} | **VI:** ${p.indices.vi}`,
            inline: true
        })),
        footer: { text: "Details & Season History auf der Website." }
    };
    await discordFetch(`/channels/${CH_RESULTS}/messages`, 'POST', { embeds: [embed] });
}

// ... include updateLpLeaderboard and syncMatchEvent exports ...
module.exports = { updateLpLeaderboard, updatePowerRankings, postMatchSummary, syncMatchEvent: require('./events').syncMatchEvent };
