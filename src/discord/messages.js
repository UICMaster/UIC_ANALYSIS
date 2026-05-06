/**
 * src/discord/messages.js
 * Formats and delivers the analytical leaderboards to Discord.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE = 'https://discord.com/api/v10';

const CH_LP = process.env.DISCORD_CH_LP;
const CH_CARRY = process.env.DISCORD_CH_CARRY;
const CH_TACTICIAN = process.env.DISCORD_CH_TACTICIAN;
const CH_OVERVIEW = process.env.DISCORD_CH_OVERVIEW; // 👈 The new Secret

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
    const messages = await discordFetch(`/channels/${channelId}/messages?limit=20`);
    if (messages && messages.length > 0) {
        for (const msg of messages) {
            if (msg.author.bot) {
                await discordFetch(`/channels/${channelId}/messages/${msg.id}`, 'DELETE');
            }
        }
    }
}

/**
 * The Master Leaderboard Generator (Two-Column Layout)
 */
async function postLeaderboard(channelId, title, leftHeader, rightHeader, players, formatCallback) {
    if (!channelId) return;
    await clearChannel(channelId);

    const validPlayers = players.filter(p => p !== null);
    let embeds = [];
    
    // We chunk by 15 players so we don't hit Discord's 1024-character limit for fields
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
                { name: leftHeader, value: columnLeft, inline: true },
                { name: rightHeader, value: columnRight, inline: true }
            ],
            footer: i === 0 ? { text: "Bereitgestellt durch Ultra Instinct Crew" } : null
        });
    }

    if (embeds.length > 0) {
        await discordFetch(`/channels/${channelId}/messages`, 'POST', { embeds: embeds });
        console.log(`   ✅ [Discord] Posted ${title}`);
    }
}

// --- SCORE MATH & AVERAGES ---

function getRankScore(tier, rank, lp) {
    const tiers = { "CHALLENGER": 90000, "GRANDMASTER": 80000, "MASTER": 70000, "DIAMOND": 60000, "EMERALD": 50000, "PLATINUM": 40000, "GOLD": 30000, "SILVER": 20000, "BRONZE": 10000, "IRON": 0, "UNRANKED": 0 };
    const ranks = { "I": 4000, "II": 3000, "III": 2000, "IV": 1000 };
    return (tiers[tier] || 0) + (ranks[rank] || 0) + parseInt(lp || 0);
}

function getAverageRankString(ranks) {
    if (!ranks || ranks.length === 0) return "UNRANKED";
    const totalScore = ranks.reduce((sum, r) => sum + getRankScore(r.tier, r.rank, r.lp), 0);
    const avg = totalScore / ranks.length;

    if (avg <= 0) return "UNRANKED";

    const tierNames = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
    let tierIndex = Math.floor(avg / 10000);
    if (tierIndex > 9) tierIndex = 9;
    
    const tier = tierNames[tierIndex];
    if (tierIndex >= 7) return tier; // Master+ doesn't use divisions conventionally in averages

    const remainder = avg % 10000;
    let rank = "IV";
    if (remainder >= 3500) rank = "I";
    else if (remainder >= 2500) rank = "II";
    else if (remainder >= 1500) rank = "III";

    return `${tier} ${rank}`;
}

// --- UPDATERS ---

async function updateLpLeaderboard(data) {
    if (!data || data.length === 0) return;
    data.sort((a, b) => getRankScore(b.tier, b.rank, b.lp) - getRankScore(a.tier, a.rank, a.lp));
    
    await postLeaderboard(CH_LP, "🏆 UIC Rangliste SoloQ/DuoQ", "Spieler", "Rang & LP", data, (p, rank) => {
        const emoji = RANK_EMOJIS[p.tier] || RANK_EMOJIS["UNRANKED"];
        return {
            left: `**${rank}.** ${p.gameName}#${p.tagLine} *(${p.team})*`,
            right: `${emoji} ${p.tier} ${p.rank} (${p.lp} LP)`
        };
    });
}

async function updateCarryIndex(data) {
    if (!data || data.length === 0) return;
    data.sort((a, b) => b.carryIndex - a.carryIndex); // Using the new math index!
    
    await postLeaderboard(CH_CARRY, "⚔️ UIC Rangliste Carry Index", "Spieler", "Form Score (Last 10)", data, (p, rank) => {
        return {
            left: `**${rank}.** ${p.gameName}#${p.tagLine} *(${p.team})*`,
            right: `🏆 **${p.carryIndex}** CI | ⚔️ ${p.dpm} DPM`
        };
    });
}

async function updateTacticianLedger(data) {
    if (!data || data.length === 0) return;
    data.sort((a, b) => b.tacticianIndex - a.tacticianIndex); // Using the new math index!
    
    await postLeaderboard(CH_TACTICIAN, "🧠 UIC Rangliste Tactician Index", "Spieler", "Map Control (Last 10)", data, (p, rank) => {
        return {
            left: `**${rank}.** ${p.gameName}#${p.tagLine} *(${p.team})*`,
            right: `🧠 **${p.tacticianIndex}** TI | 🎯 ${p.kp}% KP`
        };
    });
}

async function updateTeamOverview(teamOverviewData) {
    if (!CH_OVERVIEW || teamOverviewData.length === 0) return;
    await clearChannel(CH_OVERVIEW);

    let embeds = [];

    for (const team of teamOverviewData) {
        const avgRankStr = getAverageRankString(team.activeRanks);
        const avgTierName = avgRankStr.split(" ")[0]; // Gets just "EMERALD" from "EMERALD II"
        const avgEmoji = RANK_EMOJIS[avgTierName] || RANK_EMOJIS["UNRANKED"];

        let description = `**Durchschnittliche Elo:** ${avgEmoji} ${avgRankStr}\n\n**Roster:**\n`;

        team.roster.forEach(p => {
            let prefix = "🔹";
            let suffix = `(${p.role})`;
            
            // Highlight Staff & Captains
            if (p.role === "MNG") { prefix = "👔"; suffix = "(Manager)"; }
            else if (p.role === "COH") { prefix = "📋"; suffix = "(Coach)"; }
            else if (p.isCaptain) { prefix = "👑"; }

            // Attach Rank info for standard players
            let rankInfo = "";
            if (p.rankData && p.role !== "MNG" && p.role !== "COH") {
                const rankEmoji = RANK_EMOJIS[p.rankData.tier] || RANK_EMOJIS["UNRANKED"];
                rankInfo = ` - ${rankEmoji} ${p.rankData.tier} ${p.rankData.rank}`;
            }

            description += `${prefix} **${p.gameName}** ${suffix}${rankInfo}\n`;
        });

        embeds.push({
            title: `🛡️ ${team.teamDisplay}`,
            color: UIC_COLOR,
            description: description
        });
    }

    // Discord allows up to 10 embeds per message
    for (let i = 0; i < embeds.length; i += 10) {
        const chunk = embeds.slice(i, i + 10);
        await discordFetch(`/channels/${CH_OVERVIEW}/messages`, 'POST', { embeds: chunk });
    }
    
    console.log(`   ✅ [Discord] Posted Team Overview to channel ${CH_OVERVIEW}`);
}

module.exports = { updateLpLeaderboard, updateCarryIndex, updateTacticianLedger, updateTeamOverview };
