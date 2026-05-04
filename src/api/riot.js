/**
 * src/api/riot.js
 * Handles Riot API requests with built-in rate-limit protection.
 */

const API_KEY = process.env.RIOT_API_KEY;
// For Match-v5 and Account-v1, Riot uses broad routing (europe, americas, asia)
const REGION_BASE = 'https://europe.api.riotgames.com'; 

// The Architect's Secret: A simple delay function to prevent Rate Limit (429) errors
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The "Polite" base fetcher. 
 * Every Riot API call goes through here to ensure we don't spam their servers.
 */
async function riotFetch(endpoint) {
    if (!API_KEY) throw new Error("RIOT_API_KEY is missing!");

    const url = `${REGION_BASE}${endpoint}`;
    
    try {
        const response = await fetch(url, {
            headers: { 'X-Riot-Token': API_KEY }
        });

        // If we hit a rate limit, the API tells us how long to wait in the 'Retry-After' header
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 2;
            console.warn(`⚠️ [Riot API] Rate limited! Sleeping for ${retryAfter} seconds...`);
            await delay(retryAfter * 1000);
            return riotFetch(endpoint); // Retry the exact same call after waiting
        }

        if (!response.ok) {
            throw new Error(`Riot API Error ${response.status}: ${response.statusText}`);
        }

        // Wait a tiny bit (100ms) after a successful call just to be safe
        await delay(100); 
        return await response.json();

    } catch (error) {
        console.error(`❌ [Riot API] Request failed for ${endpoint} ->`, error.message);
        return null;
    }
}

// ---------------------------------------------------------
// EXPORTED FUNCTIONS
// ---------------------------------------------------------

/**
 * 1. Convert GameName#TagLine into an encrypted PUUID
 */
async function getPUUID(gameName, tagLine) {
    console.log(`   -> Fetching PUUID for ${gameName}#${tagLine}`);
    // Riot requires URI encoding for names with spaces (e.g. "UIC Speedy" -> "UIC%20Speedy")
    const safeName = encodeURIComponent(gameName);
    const safeTag = encodeURIComponent(tagLine);
    
    const data = await riotFetch(`/riot/account/v1/accounts/by-riot-id/${safeName}/${safeTag}`);
    return data ? data.puuid : null;
}

/**
 * 2. Get the last X Match IDs for a specific PUUID
 * We filter by queue=440 (Flex) or queue=420 (SoloQ) if you want to be specific, 
 * but for scouting, we usually just want their recent games.
 */
async function getRecentMatches(puuid, count = 5) {
    console.log(`   -> Fetching last ${count} matches for ${puuid.substring(0, 8)}...`);
    // queue=420 is Ranked Solo/Duo. Remove `?queue=420&` if you want Flex/Normals too.
    return await riotFetch(`/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`);
}

/**
 * 3. Get the End-of-Game Scoreboard Data
 */
async function getMatchData(matchId) {
    console.log(`   -> Fetching Match Data for ${matchId}`);
    return await riotFetch(`/lol/match/v5/matches/${matchId}`);
}

/**
 * 4. Get the Minute-by-Minute Timeline Data (Crucial for GD@15)
 */
async function getMatchTimeline(matchId) {
    console.log(`   -> Fetching Match Timeline for ${matchId}`);
    return await riotFetch(`/lol/match/v5/matches/${matchId}/timeline`);
}

module.exports = { 
    getPUUID, 
    getRecentMatches, 
    getMatchData, 
    getMatchTimeline 
};
