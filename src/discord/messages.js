/**
 * src/discord/messages.js
 * Handles the formatting and posting of Discord Leaderboards.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE = 'https://discord.com/api/v10';

// Environment variables for your channels
const CH_LP = process.env.DISCORD_CH_LP;
const CH_CARRY = process.env.DISCORD_CH_CARRY;
const CH_TACTICIAN = process.env.DISCORD_CH_TACTICIAN;

/**
 * Standard fetch wrapper for the Discord API
 */
async function discordFetch(endpoint, method = 'GET', body = null) {
    if (!BOT_TOKEN) return null;

    const options = {
        method,
        headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };
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
        console.error(`❌ [Discord API] Fetch Error:`, error.message);
        return null;
    }
}

/**
 * Deletes recent bot messages in a channel to keep the leaderboard clean
 */
async function clearChannel(channelId) {
    if (!channelId) return;
    const messages = await discordFetch(`/channels/${channelId}/messages?limit=10`);
    if (!messages) return;

    for (const msg of messages) {
        // Only delete the bot's own messages
        if (msg.author.bot) {
            await discordFetch(`/channels/${channelId}/messages/${msg.id}`, 'DELETE');
        }
    }
}

/**
 * The Master Leaderboard Generator
 * Chunks players into groups of 10 and creates a stacked embed array.
 */
async function postLeaderboard(channelId, title, colorHex, players, formatCallback) {
    if (!channelId) {
        console.log(`⚠️ Channel ID missing for ${title}. Skipping...`);
        return;
    }

    await clearChannel(channelId);

    // Filter out nulls and sort (the formatCallback should ideally pre-sort, but we ensure it's clean)
    const validPlayers = players.filter(p => p !== null);
    
    let embeds = [];
    const chunkSize = 10;

    for (let i = 0; i < validPlayers.length; i += chunkSize) {
        const chunk = validPlayers.slice(i, i + chunkSize);
        
        let description = "";
        chunk.forEach((player, index) => {
            const overallRank = i + index + 1;
            
            // Format the identity: Ping the Discord User if we have their ID, otherwise use Riot Name
            const identity = player.discordId 
                ? `<@${player.discordId}> (${player.gameName})` 
                : `**${player.gameName}**`;

            description += `**${overallRank}.** ${identity}\n${formatCallback(player)}\n\n`;
        });

        embeds.push({
            title: i === 0 ? title : `${title} (Cont.)`,
            color: parseInt(colorHex.replace("#", ""), 16),
            description: description,
            footer: i === 0 ? { text: "Organized by UIC Analytics Engine" } : null
        });
    }

    // Discord allows a max of 10 embeds per message. 60 players = 6 embeds, so we are safe.
    if (embeds.length > 0) {
        await discordFetch(`/channels/${channelId}/messages`, 'POST', { embeds: embeds });
        console.log(`   -> ✅ [Discord] Posted ${title} to channel ${channelId}`);
    }
}

// ---------------------------------------------------------
// EXPORTED UPDATERS
// ---------------------------------------------------------

/**
 * 1. Updates the SoloQ LP Leaderboard
 * Expects an array of objects: { gameName, discordId, tier, rank, lp }
 */
async function updateLpLeaderboard(lpDataArray) {
    // Standard League Sorting Logic (Challenger > Iron, High LP > Low LP)
    const tierValues = { "CHALLENGER": 10, "GRANDMASTER": 9, "MASTER": 8, "DIAMOND": 7, "EMERALD": 6, "PLATINUM": 5, "GOLD": 4, "SILVER": 3, "BRONZE": 2, "IRON": 1 };
    const rankValues = { "I": 4, "II": 3, "III": 2, "IV": 1 };

    lpDataArray.sort((a, b) => {
        if (tierValues[a.tier] !== tierValues[b.tier]) return tierValues[b.tier] - tierValues[a.tier];
        if (rankValues[a.rank] !== rankValues[b.rank]) return rankValues[b.rank] - rankValues[a.rank];
        return b.lp - a.lp;
    });

    await postLeaderboard(CH_LP, "🏆 Organizational LP Standings", "#FFD700", lpDataArray, (p) => {
        return `└ Rank: ${p.tier} ${p.rank} (${p.lp} LP)`;
    });
}

/**
 * 2. Updates the Carry Index (Top & Mid Laners sorted by GD@15)
 * Expects an array of objects: { gameName, discordId, gd15, dmgPerGold }
 */
async function updateCarryIndex(carryDataArray) {
    // Sort by highest Gold Difference at 15
    carryDataArray.sort((a, b) => b.gd15 - a.gd15);

    await postLeaderboard(CH_CARRY, "⚔️ The Carry Index (GD@15)", "#E22828", carryDataArray, (p) => {
        const sign = p.gd15 > 0 ? "+" : "";
        return `└ GD@15: **${sign}${p.gd15}** | Dmg/Gold: ${p.dmgPerGold}`;
    });
}

/**
 * 3. Updates the Tacticians Ledger (Junglers & Supports sorted by KP% / VSPM)
 * Expects an array of objects: { gameName, discordId, kp, vspm }
 */
async function updateTacticianLedger(tacticianDataArray) {
    // Sort by highest Kill Participation
    tacticianDataArray.sort((a, b) => b.kp - a.kp);

    await postLeaderboard(CH_TACTICIAN, "🛡️ Tacticians Ledger (KP & Vision)", "#287AE2", tacticianDataArray, (p) => {
        return `└ KP: **${p.kp}%** | VSPM: ${p.vspm}`;
    });
}

module.exports = { updateLpLeaderboard, updateCarryIndex, updateTacticianLedger };
