/**
 * src/discord/events.js
 * Handles creating and updating Discord Server Events for upcoming matches.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API_BASE = 'https://discord.com/api/v10';

// Change this to your org's actual Twitch channel!
const TWITCH_URL = 'https://twitch.tv/your_org_channel'; 

/**
 * Standard fetch wrapper for the Discord API
 */
async function discordFetch(endpoint, method = 'GET', body = null) {
    if (!BOT_TOKEN || !GUILD_ID) {
        console.error("❌ Missing Discord Bot Token or Guild ID!");
        return null;
    }

    const options = {
        method,
        headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        
        // Handle rate limits smoothly
        if (response.status === 429) {
            const errorData = await response.json();
            console.warn(`⚠️ [Discord API] Rate limited! Retrying after ${errorData.retry_after} seconds...`);
            await new Promise(res => setTimeout(res, errorData.retry_after * 1000));
            return discordFetch(endpoint, method, body);
        }

        if (!response.ok) {
            const errorData = await response.json();
            console.error(`❌ Discord API Error (${response.status}):`, errorData);
            return null;
        }
        
        // DELETE and some PATCH requests return 204 No Content
        return response.status === 204 ? true : await response.json();
    } catch (error) {
        console.error(`❌ Discord Fetch Error:`, error.message);
        return null;
    }
}

/**
 * Creates or updates a match event based on the PrimeBot schedule
 */
async function syncMatchEvent(matchData) {
    const startTime = new Date(matchData.matchTime);
    
    // Discord requires an end time for external events (usually 2 hours after start)
    const endTime = new Date(startTime.getTime() + (2 * 60 * 60 * 1000));

    // Safety check: Discord will throw an error if we try to schedule an event in the past
    if (startTime < new Date()) {
        console.log(`   -> 🕒 Match ${matchData.matchId} is in the past. Skipping event creation.`);
        return;
    }

    // --- Build the Professional Description ---
    let description = `🏆 **Prime League Match**\n⚔️ **Team ${matchData.myTeam.toUpperCase()} vs ${matchData.enemyTeamName}**\n\n`;

    if (matchData.isPredicted) {
        description += `*Rosters are not fully locked yet. Stand by for the official Scouting Report...*\n\n`;
    } else {
        description += `📊 **Pre-Game Scouting Report Ready!**\n🔗 [Click here for Lane-by-Lane Analysis](https://yourwebsite.com/scouting/${matchData.myTeam})\n\n`;
    }
    
    // The Invisible ID Tag (so the bot knows which event is which)
    description += `\n*MatchID: ${matchData.matchId}*`;

    // --- The Discord Event Payload ---
    const eventPayload = {
        name: `UIC ${matchData.myTeam.toUpperCase()} vs ${matchData.enemyTeamName}`,
        privacy_level: 2, // 2 = GUILD_ONLY (Standard)
        scheduled_start_time: startTime.toISOString(),
        scheduled_end_time: endTime.toISOString(),
        entity_type: 3, // 3 = EXTERNAL LINK
        entity_metadata: { location: TWITCH_URL },
        description: description
    };

    // 1. Fetch all active events in the server
    const activeEvents = await discordFetch(`/guilds/${GUILD_ID}/scheduled-events`);
    if (!activeEvents) return;

    // 2. Look for our Match ID in the event descriptions
    const existingEvent = activeEvents.find(e => e.description && e.description.includes(`MatchID: ${matchData.matchId}`));

    if (existingEvent) {
        // If the description has changed (e.g., predicted -> locked), update it!
        if (existingEvent.description !== description) {
            console.log(`   -> 🔄 [Discord] Updating existing event for Match ${matchData.matchId}`);
            await discordFetch(`/guilds/${GUILD_ID}/scheduled-events/${existingEvent.id}`, 'PATCH', eventPayload);
        } else {
            console.log(`   -> ✅ [Discord] Event for Match ${matchData.matchId} is already up to date.`);
        }
    } else {
        // Event doesn't exist yet, create it!
        console.log(`   -> ✨ [Discord] Creating NEW event for Match ${matchData.matchId}`);
        await discordFetch(`/guilds/${GUILD_ID}/scheduled-events`, 'POST', eventPayload);
    }
}

module.exports = { syncMatchEvent };
