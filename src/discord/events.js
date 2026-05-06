/**
 * src/discord/events.js
 * Handles creating and updating Discord Server Events for upcoming matches.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API_BASE = 'https://discord.com/api/v10';

// Replace with your Org's actual Twitch or stream link
const TWITCH_URL = 'https://twitch.tv/your_twitch_channel'; 

// Replace this with your upcoming GitHub Pages URL (Repository B)
const WEBSITE_BASE_URL = 'https://your-github-username.github.io/UIC-Dashboard';

// Replace with your Org's matchday banner image (JPG or PNG)
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
    const endTime = new Date(startTime.getTime() + (2 * 60 * 60 * 1000)); // 2 hour duration

    if (startTime < new Date()) return; // Don't create past events

    // Cleanly capitalize the team name (e.g., "prime" -> "Prime")
    const teamNameClean = matchData.myTeam.charAt(0).toUpperCase() + matchData.myTeam.slice(1);

    let description = `🏆 **Prime League Match**\n⚔️ **UIC ${teamNameClean} vs ${matchData.enemyTeamName}**\n\n`;
    let imageBase64 = null;

    if (matchData.isPredicted) {
        description += `*Die Roster sind noch nicht vollständig bestätigt. Das offizielle Scouting-Update folgt...*\n\n`;
    } else {
        description += `📊 **Pre-Game Scouting Report ist online!**\n🔗 [Klicke hier für die Lane-by-Lane Analyse](${WEBSITE_BASE_URL}?match=${matchData.matchId})\n\n`;
        // Grab the hype banner ONLY when the roster is officially locked
        imageBase64 = await getBase64Image(BANNER_IMAGE_URL);
    }
    
    description += `\n*MatchID: ${matchData.matchId}*`;

    const eventPayload = {
        name: `UIC ${teamNameClean} vs ${matchData.enemyTeamName}`,
        privacy_level: 2, // 2 = GUILD_ONLY
        scheduled_start_time: startTime.toISOString(),
        scheduled_end_time: endTime.toISOString(),
        entity_type: 3, // 3 = EXTERNAL (URL)
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
        // If description changed (e.g., from predicted to locked), update the event
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
