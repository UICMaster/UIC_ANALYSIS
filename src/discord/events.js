/**
 * src/discord/events.js
 * Manages Discord Scheduled Events for Prime League.
 */

const { fetchWithRetry } = require('../utils/network');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API_BASE = 'https://discord.com/api/v10';
const TWITCH_URL = 'https://www.twitch.tv/ultrainstinctcrew';

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

    const { status, data } = await fetchWithRetry(url, options);
    return data;
}

async function syncMatchEvent(matchData) {
    const startTime = new Date(matchData.matchTime);
    // Allow updates for matches that started up to 4 hours ago (handles delays)
    if (startTime.getTime() + (4 * 60 * 60 * 1000) < Date.now()) return;

    const teamRaw = matchData.myTeam || "Unknown";
    const teamNameClean = teamRaw.charAt(0).toUpperCase() + teamRaw.slice(1);

    let description = `🏆 **Prime League Match**\n⚔️ **UIC ${teamNameClean} vs ${matchData.enemyTeamName}**\n\n`;
    
    if (matchData.isPredicted) {
        description += `⚠️ *Lineups are predicted based on team rosters.*`;
    } else {
        description += `✅ **Confirmed Lineups:**\n`;
        description += `🔵 **UIC:** ${matchData.myStarters.join(', ')}\n`;
        description += `🔴 **Enemy:** ${matchData.enemyStarters.join(', ')}`;
    }

    const activeEvents = await discordFetch(`/guilds/${GUILD_ID}/scheduled-events`) || [];
    const existingEvent = activeEvents.find(e => e.description && e.description.includes(`MatchID: ${matchData.matchId}`));

    const eventPayload = {
        name: `UIC ${teamNameClean} vs ${matchData.enemyTeamName}`,
        privacy_level: 2,
        scheduled_start_time: startTime.toISOString(),
        scheduled_end_time: new Date(startTime.getTime() + (2 * 60 * 60 * 1000)).toISOString(),
        entity_type: 3,
        entity_metadata: { location: TWITCH_URL },
        description: description
    };

    if (existingEvent) {
        const timeChanged = new Date(existingEvent.scheduled_start_time).getTime() !== startTime.getTime();
        const descChanged = existingEvent.description !== description;

        if (timeChanged || descChanged) {
            console.log(`   🔄 [Discord] Updating Event for Match ${matchData.matchId}`);
            await discordFetch(`/guilds/${GUILD_ID}/scheduled-events/${existingEvent.id}`, 'PATCH', eventPayload);
        }
    } else {
        console.log(`   ✨ [Discord] Creating NEW Event for Match ${matchData.matchId}`);
        await discordFetch(`/guilds/${GUILD_ID}/scheduled-events`, 'POST', eventPayload);
    }
}

module.exports = { syncMatchEvent };
