/**
 * src/discord/messages.js
 * Formats and delivers the analytical leaderboards to Discord via Smart Editing.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE = 'https://discord.com/api/v10';

const CH_LP = process.env.DISCORD_CH_LP;
const CH_LEADERBOARD = process.env.DISCORD_CH_LEADERBOARD;
const CH_OVERVIEW = process.env.DISCORD_CH_OVERVIEW;

const UIC_COLOR = 0x00F0FF; 

const RANK_EMOJIS = {
    "CHALLENGER": "<:challenger:1501324978321101021>", "GRANDMASTER": "<:grandmaster:1501325107128434748>", "MASTER": "<:master:1501325178993512478>",
    "DIAMOND": "<:diamond:1501325003671601224>", "EMERALD": "<:emerald:1501325048219304039>", "PLATINUM": "<:platinum:1501325207330095104>",
    "GOLD": "<:gold:1501325080960172072>", "SILVER": "<:silver:1501325230868529345>", "BRONZE": "<:bronze:1501324928606146761>",
    "IRON": "<:iron:1501325151466422282>", "UNRANKED": "<:unranked:1501325256227553362>"
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

async function updateOrPostMessage(channelId, embeds) {
    if (!channelId || embeds.length === 0) return;

    // Discord allows max 10 embeds per message.
    const embedChunks = [];
    for (let i = 0; i < embeds.length; i += 10) {
        embedChunks.push(embeds.slice(i, i + 10));
    }

    const messages = await discordFetch(`/channels/${channelId}/messages?limit=10`);
    const botMessages = messages ? messages.filter(m => m.author.bot) : [];
    botMessages.sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < embedChunks.length; i++) {
        const payload = { embeds: embedChunks[i] };
        if (i < botMessages.length) {
            await discordFetch(`/channels/${channelId}/messages/${botMessages[i].id}`, 'PATCH', payload);
        } else {
            await discordFetch(`/channels/${channelId}/messages`, 'POST', payload);
        }
    }

    for (let i = embedChunks.length; i < botMessages.length; i++) {
        await discordFetch(`/channels/${channelId}/messages/${botMessages[i].id}`, 'DELETE');
    }
}

function getRankScore(tier, rank, lp) {
    const tiers = { "CHALLENGER": 90000, "GRANDMASTER": 80000, "MASTER": 70000, "DIAMOND": 60000, "EMERALD": 50000, "PLATINUM": 40000, "GOLD": 30000, "SILVER": 20000, "BRONZE": 10000, "IRON": 0, "UNRANKED": 0 };
    const ranks = { "I": 4000, "II": 3000, "III": 2000, "IV": 1000 };
    return (tiers[tier] || 0) + (ranks[rank] || 0) + parseInt(lp || 0);
}

const capitalize = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

/**
 * Universal Formatter for 3-Column Leaderboards
 */
async function postRankingsEmbeds(channelId, title, column3Name, data, formatCallback) {
    let embeds = [];
    const chunkSize = 15; // 15 players per embed keeps it safe from Discord's 1024 character limit per field

    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);

        let colSpieler = "";
        let colTeam = "";
        let colWertung = "";

        chunk.forEach((player, index) => {
            const rank = i + index + 1;
            const row = formatCallback(player, rank);
            colSpieler += row.spieler + "\n";
            colTeam += row.team + "\n";
            colWertung += row.wertung + "\n";
        });

        embeds.push({
            title: i === 0 ? title : `${title} (Fortsetzung)`,
            color: UIC_COLOR,
            fields: [
                { name: "Spieler", value: colSpieler || "-", inline: true },
                { name: "Team", value: colTeam || "-", inline: true },
                { name: column3Name, value: colWertung || "-", inline: true }
            ],
            footer: { text: "Bereitgestellt durch UIC" },
            timestamp: new Date().toISOString()
        });
    }

    await updateOrPostMessage(channelId, embeds);
}

// 1. LP Leaderboard (All Players)
async function updateLpLeaderboard(data) {
    if (!CH_LP || data.length === 0) return;
    data.sort((a, b) => getRankScore(b.tier, b.rank, b.lp) - getRankScore(a.tier, a.rank, a.lp));
    
    await postRankingsEmbeds(CH_LP, "UIC Rangliste SoloQ/DuoQ", "Rang & LP", data, (p, rank) => {
        const emoji = RANK_EMOJIS[p.tier] || RANK_EMOJIS["UNRANKED"];
        const tierStr = p.tier ? capitalize(p.tier) : "Unranked";
        const rankStr = p.rank ? p.rank : "";
        const lpStr = p.lp !== undefined ? `(${p.lp} LP)` : "";

        return {
            spieler: `**${rank}.** ${p.gameName}#${p.tagLine}`,
            team: p.team || "-",
            wertung: `${emoji} ${tierStr} ${rankStr} ${lpStr}`.trim()
        };
    });
    
    console.log(`   ✅ [Discord] Updated LP Leaderboard (Alle Spieler)`);
}

// 2. Master DNA Leaderboard (UPS - All Players)
async function updateMasterLeaderboard(data) {
    if (!CH_LEADERBOARD || data.length === 0) return;
    
    // Sort by Overall UPS
    data.sort((a, b) => b.metrics.ups - a.metrics.ups);
    
    await postRankingsEmbeds(CH_LEADERBOARD, "UIC Power Ranking", "Wertung", data, (p, rank) => {
        const { ups, vi, ti, ci } = p.metrics;
        return {
            spieler: `**${rank}.** ${p.gameName}#${p.tagLine}`,
            team: p.team || "-",
            wertung: `Score: ${ups} (VI: ${vi} | TI: ${ti} | CI: ${ci})`
        };
    });

    console.log(`   ✅ [Discord] Updated Master DNA Leaderboard (Alle Spieler)`);
}

// 3. Team Overview
async function updateTeamOverview(teamOverviewData) {
    if (!CH_OVERVIEW || teamOverviewData.length === 0) return;

    const roleMapping = { "TOP": "Toplane", "JGL": "Jungle", "MID": "Midlane", "BOT": "Botlane", "SUP": "Support", "MNG": "Manager", "COH": "Coach" };
    let embeds = [];

    for (const team of teamOverviewData) {
        let nameColumn = "";
        let roleColumn = "";

        team.roster.forEach(p => {
            const tag = p.tagLine && p.tagLine !== "undefined" ? `#${p.tagLine}` : "";
            const crown = p.isCaptain ? " 👑" : "";
            const subLabel = p.rosterStatus === "substitute" ? " *(Sub)*" : "";
            
            nameColumn += `${p.gameName}${tag}${crown}\n`;
            roleColumn += `${roleMapping[p.role] || p.role}${subLabel}\n`; 
        });

        embeds.push({
            title: team.teamDisplay, color: UIC_COLOR,
            fields: [ { name: "Kader", value: nameColumn || "-", inline: true }, { name: "Rolle", value: roleColumn || "-", inline: true } ]
        });
    }

    // Add footer to the last embed in the list
    if (embeds.length > 0) {
        embeds[embeds.length - 1].footer = { text: "Bereitgestellt durch UIC" };
        embeds[embeds.length - 1].timestamp = new Date().toISOString();
    }

    await updateOrPostMessage(CH_OVERVIEW, embeds);
    console.log(`   ✅ [Discord] Updated Team Overview`);
}

module.exports = { updateLpLeaderboard, updateMasterLeaderboard, updateTeamOverview };
