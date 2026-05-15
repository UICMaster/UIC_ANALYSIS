/**
 * src/api/riot.js
 * Handles Riot API requests with an invincible Global Batch Queue.
 */

// 1. AGGRESSIVE SANITIZER: Destroys any hidden characters from GitHub Actions
let rawKey = process.env.RIOT_API_KEY || "";
const API_KEY = rawKey.replace(/['"`\s\r\n]/g, ''); 

const REGION_BASE = 'https://europe.api.riotgames.com'; 
const EUW_BASE = 'https://euw1.api.riotgames.com';      

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 2. HIGH-PERFORMANCE PACER: Lowered to 100ms for your Production Key
const RATE_LIMIT_DELAY_MS = 100; 
let requestQueue = Promise.resolve(); 

async function executeFetch(url) {
    if (!API_KEY) throw new Error("RIOT_API_KEY is missing entirely!");
    
    // 3. THE FIREWALL BYPASS: Inject the key directly into the URL
    const fetchUrl = url.includes('?') 
        ? `${url}&api_key=${API_KEY}` 
        : `${url}?api_key=${API_KEY}`;
    
    try {
        // No headers! We bypass the Node.js native fetch header drop bug.
        const response = await fetch(fetchUrl);
        
        // 4. THE INTELLIGENT BRAIN: Still reacts to Riot's 429 commands
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 5;
            console.warn(`⚠️ [Riot] Emergency Rate Limit Hit! Sleeping for ${retryAfter}s...`);
            await delay(retryAfter * 1000);
            return executeFetch(url); 
        }
        
        if (!response.ok) {
            const errorBody = await response.text(); 
            throw new Error(`Riot API Error ${response.status}: ${response.statusText} | Riot Says: ${errorBody}`);
        }
        
        return await response.json();
    } catch (error) {
        // Clean up the error log so it doesn't print your API key to the GitHub logs
        console.error(`❌ [Riot API] Request failed for ${url.split('?')[0]} ->`, error.message);
        return null;
    }
}

function riotFetch(url) {
    return new Promise((resolve) => {
        requestQueue = requestQueue.then(async () => {
            const result = await executeFetch(url);
            resolve(result);
            await delay(RATE_LIMIT_DELAY_MS); 
        });
    });
}

async function getPUUID(gameName, tagLine) {
    const safeName = encodeURIComponent(gameName.trim());
    const safeTag = encodeURIComponent(tagLine.trim());
    const data = await riotFetch(`${REGION_BASE}/riot/account/v1/accounts/by-riot-id/${safeName}/${safeTag}`);
    return data ? data.puuid : null;
}

async function getAccountByPUUID(puuid) {
    return await riotFetch(`${REGION_BASE}/riot/account/v1/accounts/by-puuid/${puuid}`);
}

async function getRankedData(puuid) {
    const leagueData = await riotFetch(`${EUW_BASE}/lol/league/v4/entries/by-puuid/${puuid}`);
    if (!leagueData) return null;

    const soloQ = leagueData.find(queue => queue.queueType === "RANKED_SOLO_5x5");
    return soloQ ? { tier: soloQ.tier, rank: soloQ.rank, lp: soloQ.leaguePoints, wins: soloQ.wins, losses: soloQ.losses } : null;
}

async function getRecentMatches(puuid, count = 10) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`);
}

async function getMatchData(matchId) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId}`);
}

async function getMatchTimeline(matchId) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId}/timeline`);
}

module.exports = { getPUUID, getAccountByPUUID, getRankedData, getRecentMatches, getMatchData, getMatchTimeline };
