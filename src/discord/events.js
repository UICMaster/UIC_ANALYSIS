/**
 * src/discord/events.js
 * Handles creating and updating Discord Server Events for upcoming matches.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API_BASE = 'https://discord.com/api/v10';

const TWITCH_URL = 'https://twitch.tv/your_org_channel'; 

// Replace this with the URL to your organization's matchday banner image (JPG or PNG)
const BANNER_IMAGE_URL = 'https://example.com/your-org-banner.jpg'; 

async function discordFetch(endpoint, method = 'GET', body = null) {
    if (!BOT_TOKEN || !GUILD_ID) return null;

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

/**
 * Helper function to download an image and convert it for Discord
 */
async function getBase64Image(url) {
    try {
        const res = await fetch(url);
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        return `data:image/jpeg;base64,${base64}`;
    } catch (error) {
        console.error("⚠️ Failed to load banner image.");
        return null;
    }
}

async function syncMatchEvent(matchData) {
    const startTime = new Date(matchData.matchTime);
    const endTime = new Date(startTime.getTime() + (2 * 60 * 60 * 1000));

    if (startTime < new Date()) return; // Don't create past events

    let description = `🏆 **Prime League Match**\n⚔️ **Team ${matchData.myTeam.toUpperCase()} vs ${matchData.enemyTeamName}**\n\n`;
    let imageBase64 = null;

    if (matchData.isPredicted) {
        description += `*Rosters are not fully locked yet. Stand by for the official Scouting Report...*\n\n`;
    } else {
        description += `📊 **Pre-Game Scouting Report Ready!**\n🔗 [Click here for Lane-by-Lane Analysis](https://yourwebsite.com/match/${matchData.matchId})\n\n`;
        // Grab the hype banner ONLY when the roster is officially locked
        imageBase64 = await getBase64Image(BANNER_IMAGE_URL);
    }
    
    description += `\n*MatchID: ${matchData.matchId}*`;

    const eventPayload = {
        name: `UIC ${matchData.myTeam.toUpperCase()} vs ${matchData.enemyTeamName}`,
        privacy_level: 2,
        scheduled_start_time: startTime.toISOString(),
        scheduled_end_time: endTime.toISOString(),
        entity_type: 3,
        entity_metadata: { location: TWITCH_URL },
        description: description
    };

    if (imageBase64) {
        eventPayload.image = imageBase64;
    }

    const activeEvents = await discordFetch(`/guilds/${GUILD_ID}/scheduled-events`);
    if (!activeEvents) return;

    const existingEvent = activeEvents.find(e => e.description && e.description.includes(`MatchID: ${matchData.matchId}`));

    if (existingEvent) {
        // If description changed (e.g., from predicted to locked), update the event and attach the image!
        if (existingEvent.description !== description) {
            console.log(`   -> 🔄 [Discord] Updating existing event for Match ${matchData.matchId}`);
            await discordFetch(`/guilds/${GUILD_ID}/scheduled-events/${existingEvent.id}`, 'PATCH', eventPayload);
        }
    } else {
        console.log(`   -> ✨ [Discord] Creating NEW event for Match ${matchData.matchId}`);
        await discordFetch(`/guilds/${GUILD_ID}/scheduled-events`, 'POST', eventPayload);
    }
}

module.exports = { syncMatchEvent };
