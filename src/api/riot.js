/**
 * src/api/riot.js
 * Handles Riot API requests with an invincible Global Batch Queue.
 */

// Inside src/api/riot.js
console.log("🔍 KEY HEALTH CHECK IN NODE.JS:");
console.log(`1. Exact Length: ${API_KEY.length}`);
console.log(`2. Starts with 'RGAPI': ${API_KEY.startsWith('RGAPI')}`);

const API_KEY = process.env.RIOT_API_KEY ? process.env.RIOT_API_KEY.trim() : null;
const REGION_BASE = 'https://europe.api.riotgames.com'; 
const EUW_BASE = 'https://euw1.api.riotgames.com';      

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const RATE_LIMIT_DELAY_MS = 650; 
let requestQueue = Promise.resolve(); 

async function executeFetch(url) {
    if (!API_KEY) throw new Error("RIOT_API_KEY is missing!");
    
    try {
        const response = await fetch(url, { headers: { 'X-Riot-Token': API_KEY } });
        
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
