/**
 * src/api/riot.js
 * Handles Riot API requests with an invincible Global Batch Queue.
 */

const API_KEY = process.env.RIOT_API_KEY ? process.env.RIOT_API_KEY.trim() : null;
const REGION_BASE = 'https://europe.api.riotgames.com'; // For Account & Match routing
const EUW_BASE = 'https://euw1.api.riotgames.com';      // For Summoner & League (Ranked) routing

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// The 650ms pacing mathematically guarantees we never hit 200 requests / 2 minutes
const RATE_LIMIT_DELAY_MS = 650; 
let requestQueue = Promise.resolve(); // The global queue line

/**
 * Executes the actual fetch, handling 429s just in case.
 */
async function executeFetch(url) {
    if (!API_KEY) throw new Error("RIOT_API_KEY is missing!");
    
    try {
        const response = await fetch(url, { headers: { 'X-Riot-Token': API_KEY } });
        
        // If Riot's server is struggling, respect their manual retry timer
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 5;
            console.warn(`⚠️ [Riot] Emergency Rate Limit Hit! Sleeping for ${retryAfter}s...`);
            await delay(retryAfter * 1000);
            return executeFetch(url);
        }
        
        if (!response.ok) throw new Error(`Riot API Error ${response.status}: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error(`❌ [Riot API] Request failed for ${url} ->`, error.message);
        return null;
    }
}

/**
 * The Global Queue Wrapper.
 * Forces ALL Riot API requests into a single-file line, spaced out by 650ms.
 */
function riotFetch(url) {
    return new Promise((resolve) => {
        requestQueue = requestQueue.then(async () => {
            const result = await executeFetch(url);
            resolve(result);
            // Wait 650ms BEFORE allowing the next request in the line to start
            await delay(RATE_LIMIT_DELAY_MS); 
        });
    });
}

// --- 1. Account / PUUID ---
async function getPUUID(gameName, tagLine) {
    const safeName = encodeURIComponent(gameName.trim());
    const safeTag = encodeURIComponent(tagLine.trim());
    const data = await riotFetch(`${REGION_BASE}/riot/account/v1/accounts/by-riot-id/${safeName}/${safeTag}`);
    return data ? data.puuid : null;
}

// --- 2. Ranked LP Tracking ---
async function getRankedData(puuid) {
    const leagueData = await riotFetch(`${EUW_BASE}/lol/league/v4/entries/by-puuid/${puuid}`);
    if (!leagueData) return null;

    const soloQ = leagueData.find(queue => queue.queueType === "RANKED_SOLO_5x5");
    return soloQ ? { tier: soloQ.tier, rank: soloQ.rank, lp: soloQ.leaguePoints, wins: soloQ.wins, losses: soloQ.losses } : null;
}

// --- 3. Match History & Timelines ---
// Default changed to 10 to support our new Discord Gamification logic
async function getRecentMatches(puuid, count = 10) {
    // Omitting queue types so it pulls ALL matches (SoloQ, Flex, Normals, Custom) to ensure we get the last 10 games of form.
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`);
}

async function getMatchData(matchId) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId}`);
}

async function getMatchTimeline(matchId) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId}/timeline`);
}

module.exports = { getPUUID, getRankedData, getRecentMatches, getMatchData, getMatchTimeline };
