/**
 * src/api/riot.js
 * Handles Riot API requests with built-in rate-limit protection.
 */

const API_KEY = process.env.RIOT_API_KEY;
const REGION_BASE = 'https://europe.api.riotgames.com'; // For Account & Match routing
const EUW_BASE = 'https://euw1.api.riotgames.com';      // For Summoner & League (Ranked) routing

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function riotFetch(url) {
    if (!API_KEY) throw new Error("RIOT_API_KEY is missing!");
    try {
        const response = await fetch(url, { headers: { 'X-Riot-Token': API_KEY } });
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 2;
            console.warn(`⚠️ [Riot] Rate limited! Sleeping for ${retryAfter}s...`);
            await delay(retryAfter * 1000);
            return riotFetch(url);
        }
        if (!response.ok) throw new Error(`Riot API Error ${response.status}: ${response.statusText}`);
        await delay(100); // 100ms safety buffer
        return await response.json();
    } catch (error) {
        console.error(`❌ [Riot API] Request failed for ${url} ->`, error.message);
        return null;
    }
}

// 1. Account / PUUID
async function getPUUID(gameName, tagLine) {
    const safeName = encodeURIComponent(gameName);
    const safeTag = encodeURIComponent(tagLine);
    const data = await riotFetch(`${REGION_BASE}/riot/account/v1/accounts/by-riot-id/${safeName}/${safeTag}`);
    return data ? data.puuid : null;
}

// 2. Ranked LP Tracking (Requires Summoner ID)
async function getRankedData(puuid) {
    // Jump 1: Convert PUUID to Summoner ID
    const summonerData = await riotFetch(`${EUW_BASE}/lol/summoner/v4/summoners/by-puuid/${puuid}`);
    if (!summonerData) return null;

    // Jump 2: Fetch League Entries using Summoner ID
    const leagueData = await riotFetch(`${EUW_BASE}/lol/league/v4/entries/by-summoner/${summonerData.id}`);
    if (!leagueData) return null;

    // Filter to strictly SoloQ
    const soloQ = leagueData.find(queue => queue.queueType === "RANKED_SOLO_5x5");
    return soloQ ? { tier: soloQ.tier, rank: soloQ.rank, lp: soloQ.leaguePoints, wins: soloQ.wins, losses: soloQ.losses } : null;
}

// 3. Match History & Timelines
async function getRecentMatches(puuid, count = 5) {
    // queue=440 is Flex, 420 is SoloQ. Removing the query parameter fetches ALL match types (Prime League uses custom games)
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`);
}

async function getMatchData(matchId) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId}`);
}

async function getMatchTimeline(matchId) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId}/timeline`);
}

module.exports = { getPUUID, getRankedData, getRecentMatches, getMatchData, getMatchTimeline };
