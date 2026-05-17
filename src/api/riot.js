/**
 * src/api/riot.js
 * Handles Riot API requests with an invincible Global Batch Queue.
 * Upgraded: Dual-targeting streams with deterministic fingerprinting.
 * Optimized: Accelerated for high-tier production key rate limits.
 */

const rawKey = process.env.RIOT_API_KEY || "";
const API_KEY = rawKey.replace(/['"`\s\r\n]/g, ''); 

const REGION_BASE = 'https://europe.api.riotgames.com'; 
const EUW_BASE = 'https://euw1.api.riotgames.com';      

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const RATE_LIMIT_DELAY_MS = 10; // Optimized to 10ms for Production API Key speed
let requestQueue = Promise.resolve(); 

async function executeFetch(url) {
    if (!API_KEY) throw new Error("RIOT_API_KEY is missing!");
    try {
        const response = await fetch(url.trim(), { 
            headers: { 
                'X-Riot-Token': API_KEY,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            } 
        });
        
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 5;
            await delay(retryAfter * 1000);
            return executeFetch(url);
        }
        
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Riot API Error ${response.status} | Body: ${errorBody}`);
        }
        
        return await response.json();
    } catch (error) {
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
    if (!puuid) return null;
    return await riotFetch(`${REGION_BASE}/riot/account/v1/accounts/by-puuid/${puuid.trim()}`);
}

async function getRankedData(puuid) {
    if (!puuid) return null;
    const leagueData = await riotFetch(`${EUW_BASE}/lol/league/v4/entries/by-puuid/${puuid.trim()}`);
    if (!leagueData) return null;

    const soloQ = leagueData.find(queue => queue.queueType === "RANKED_SOLO_5x5");
    return soloQ ? { tier: soloQ.tier, rank: soloQ.rank, lp: soloQ.leaguePoints, wins: soloQ.wins, losses: soloQ.losses } : null;
}

async function getRecentMatches(puuid, count = 20) {
    if (!puuid) return { ids: [], fingerprint: "none" };

    // 1. Fetch strictly SoloQ games (queue=420) to guarantee leaderboard entries
    const soloQMatches = await getMatchesWithFilter(puuid, `queue=420&count=${count}`);

    // 2. Fetch strictly Tournament code matches (type=tourney) to protect Prime League tracking
    const tourneyMatches = await getMatchesWithFilter(puuid, `type=tourney&count=5`);

    // Merge arrays and deduplicate via Set to preserve sorting integrity
    const combinedMatches = [...new Set([...tourneyMatches, ...soloQMatches])];

    // Create a deterministic fingerprint hash to detect new games in EITHER stream
    const topSolo = soloQMatches[0] || "no_solo";
    const topTourney = tourneyMatches[0] || "no_tourney";
    const fingerprint = `${topSolo}_${topTourney}`;

    return {
        ids: combinedMatches,
        fingerprint: fingerprint
    };
}

/**
 * Helper function to isolate the history queries cleanly
 */
async function getMatchesWithFilter(puuid, filterString) {
    const url = `${REGION_BASE}/lol/match/v5/matches/by-puuid/${puuid.trim()}/ids?start=0&${filterString}`;
    const data = await riotFetch(url);
    return Array.isArray(data) ? data : [];
}

async function getMatchData(matchId) {
    if (!matchId) return null;
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId.trim()}`);
}

async function getMatchTimeline(matchId) {
    if (!matchId) return null;
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId.trim()}/timeline`);
}

module.exports = { 
    getPUUID, 
    getAccountByPUUID, 
    getRankedData, 
    getRecentMatches, 
    getMatchData, 
    getMatchTimeline 
};
