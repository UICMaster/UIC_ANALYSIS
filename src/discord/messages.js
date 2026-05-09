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
const CH_OVERVIEW = process.env.DISCORD_CH_OVERVIEW;

async function discordFetch(endpoint, method = 'GET', body = null) {
    const url = `${API_BASE}${endpoint}`;
    const options = {
        method,
        headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);
    const { data } = await fetchWithRetry(url, options);
    return data;
}

/**
 * SMART EDIT: Manages message persistence to prevent spam.
 */
async function updateOrPostMessage(channelId, embeds) {
    if (!channelId || !embeds.length) return;

    // Fixed: Limit increased to 50 to see past user chatter
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
    // Cleanup extra messages
    for (let i = embeds.length; i < botMessages.length; i++) {
        await discordFetch(`/channels/${channelId}/messages/${botMessages[i].id}`, 'DELETE');
    }
}

/**
 * SOLOQ POWER RANKINGS: Role-Normalized leaderboard
 */
async function updatePowerRankings(data) {
    if (!CH_POWER || !data.length) return;
    
    // Sort by a combined weighted average of CI, TI, and VI
    data.sort((a, b) => (b.ci + b.ti + b.vi) - (a.ci + a.ti + a.vi));

    const embeds = [{
        title: "📈 UIC Performance Index (SoloQ)",
        description: "Rolle-normalisierte Wertung basierend auf Master+ Baselines.",
        color: 0xFFAA00,
        fields: data.slice(0, 15).map((p, i) => ({
            name: `${i + 1}. ${p.gameName} (${p.team})`,
            value: `**Carry:** ${p.ci} | **Tact:** ${p.ti} | **Vanguard:** ${p.vi}`,
            inline: false
        })),
        footer: { text: "Aktualisiert alle 15 Min" },
        timestamp: new Date().toISOString()
    }];

    await updateOrPostMessage(CH_POWER, embeds);
}

/**
 * PRIME MATCH SUMMARY: Hype for the results channel
 */
async function postMatchSummary(matchResult) {
    if (!CH_RESULTS) return;

    const { teamName, enemyName, players, win } = matchResult;
    const color = win ? 0x00FF00 : 0xFF0000;

    const embed = {
        title: `${win ? '✅' : '❌'} Match Summary: UIC ${teamName} vs ${enemyName}`,
        color: color,
        fields: players.map(p => ({
            name: `${p.role}: ${p.gameName}`,
            value: `**CI:** ${p.ci} | **TI:** ${p.ti} | **VI:** ${p.vi} (${p.champion})`,
            inline: true
        })),
        footer: { text: "Deep-Dive Analytics auf der Website verfügbar." }
    };

    // We use POST here because match results should create a new history trail
    await discordFetch(`/channels/${CH_RESULTS}/messages`, 'POST', { embeds: [embed] });
}

// Helper for LP sorting
const getRankScore = (p) => {
    const tiers = { "CHALLENGER": 90000, "GRANDMASTER": 80000, "MASTER": 70000, "DIAMOND": 60000, "EMERALD": 50000, "PLATINUM": 40000, "GOLD": 30000, "SILVER": 20000, "BRONZE": 10000, "IRON": 0 };
    const divisions = { "I": 4000, "II": 3000, "III": 2000, "IV": 1000 };
    return (tiers[p.tier] || 0) + (divisions[p.rank] || 0) + (p.lp || 0);
};

async function updateLpLeaderboard(data) {
    if (!CH_LP || !data.length) return;
    data.sort((a, b) => getRankScore(b) - getRankScore(a));

    const embeds = [{
        title: "🏆 UIC SoloQ Ladder",
        color: UIC_COLOR,
        fields: [
            { name: "Spieler", value: data.map((p, i) => `**${i + 1}.** ${p.gameName} *(${p.team})*`).join('\n'), inline: true },
            { name: "Rang & LP", value: data.map(p => `${p.tier} ${p.rank} (${p.lp} LP)`).join('\n'), inline: true }
        ],
        timestamp: new Date().toISOString()
    }];
    await updateOrPostMessage(CH_LP, embeds);
}

module.exports = { updateLpLeaderboard, updatePowerRankings, postMatchSummary, syncMatchEvent: require('./events').syncMatchEvent };
