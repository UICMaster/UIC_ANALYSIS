/**
 * src/discord/events.js
 * Handles creating and updating Discord Server Events for upcoming matches.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API_BASE = 'https://discord.com/api/v10';

const TWITCH_URL = 'https://www.twitch.tv/ultrainstinctcrew'; 
const WEBSITE_BASE_URL = 'https://ultrainstinctcrew.com/';

async function discordFetch(endpoint, method = 'GET', body = null) {
    if (!BOT_TOKEN || !GUILD_ID) return null;

    const options = { method, headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        if (response.status === 429) {
            const errorData = await response.json();
            console.warn(`⚠️ [Discord Events] Rate limited. Waiting ${errorData.retry_after}s...`);
            await new Promise(res => setTimeout(res, errorData.retry_after * 1000));
            return discordFetch(endpoint, method, body);
        }
        if (!response.ok) return null;
        return response.status === 204 ? true : await response.json();
    } catch (error) {
        return null;
    }
}

async function syncMatchEvent(matchData) {
    const startTime = new Date(matchData.matchTime);
    const endTime = new Date(startTime.getTime() + (2 * 60 * 60 * 1000)); 

    if (startTime < new Date()) return; // Skip past events

    const teamRaw = matchData.myTeam || "Unknown";
    const teamNameClean = teamRaw.charAt(0).toUpperCase() + teamRaw.slice(1);

    let description = `🏆 **Prime League Match**\n⚔️ **UIC ${teamNameClean} vs ${matchData.enemyTeamName}**\n\n`;

    if (matchData.isPredicted) {
        description += `*Die Roster sind noch nicht vollständig bestätigt. Das offizielle Scouting-Update folgt...*\n\n`;
    } else {
        description += `📊 **Pre-Game Scouting Report ist online!**\n🔗 [Klicke hier für die Lane-by-Lane Analyse](${WEBSITE_BASE_URL}?match=${matchData.matchId})\n\n`;
    }
    
    description += `\n*MatchID: ${matchData.matchId}*`;

    const activeEvents = await discordFetch(`/guilds/${GUILD_ID}/scheduled-events`);
    if (!activeEvents) return;

    const existingEvent = activeEvents.find(e => e.description && e.description.includes(`MatchID: ${matchData.matchId}`));

    const eventPayload = {
        name: `UIC ${teamNameClean} vs ${matchData.enemyTeamName}`,
        privacy_level: 2, 
        scheduled_start_time: startTime.toISOString(),
        scheduled_end_time: endTime.toISOString(),
        entity_type: 3, 
        entity_metadata: { location: TWITCH_URL },
        description: description
    };

    if (existingEvent) {
        // --- RESCHEDULE DETECTOR ---
        const existingStartTime = new Date(existingEvent.scheduled_start_time).getTime();
        const newStartTime = startTime.getTime();

        const timeChanged = existingStartTime !== newStartTime;
        const descChanged = existingEvent.description !== description;

        if (descChanged || timeChanged) {
            let updateLog = `   -> 🔄 [Discord] Updating Match ${matchData.matchId}:`;
            if (timeChanged) updateLog += ` [Time Changed]`;
            if (descChanged) updateLog += ` [Status/Desc Changed]`;
            console.log(updateLog);
            
            await discordFetch(`/guilds/${GUILD_ID}/scheduled-events/${existingEvent.id}`, 'PATCH', eventPayload);
        }
    } else {
        console.log(`   -> ✨ [Discord] Creating NEW event for Match ${matchData.matchId}`);
        await discordFetch(`/guilds/${GUILD_ID}/scheduled-events`, 'POST', eventPayload);
    }
}

module.exports = { syncMatchEvent };
