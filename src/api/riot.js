/**
 * src/api/riot.js
 * Atomic Riot API wrapper powered by the new 3-Strike Network Utility.
 */

const { fetchWithRetry } = require('../utils/network');

const API_KEY = process.env.RIOT_API_KEY ? process.env.RIOT_API_KEY.trim() : null;
const REGION_BASE = 'https://europe.api.riotgames.com'; // For Account & Match
const EUW_BASE = 'https://euw1.api.riotgames.com';      // For Summoner & Ranked

/**
 * Internal wrapper to automatically attach the Riot API key to headers
 */
async function riotFetch(url) {
    if (!API_KEY) {
        console.error("❌ [Riot API] RIOT_API_KEY is missing from environment!");
        return null;
    }

    const { status, data } = await fetchWithRetry(url, {
        headers: { 'X-Riot-Token': API_KEY }
    });

    if (status === 200) return data;
    return null; // Silently handle 404s and 500s after the 3 retries
}

// --- 1. Account / PUUID ---
async function getPUUID(gameName, tagLine) {
    const safeName = encodeURIComponent(gameName.trim());
    const safeTag = encodeURIComponent(tagLine.trim());
    const data = await riotFetch(`${REGION_BASE}/riot/account/v1/accounts/by-riot-id/${safeName}/${safeTag}`);
    return data ? data : null; // Returning full object so index.js can check if name changed
}

// --- 2. Ranked LP Tracking ---
async function getRankedData(puuid) {
    const leagueData = await riotFetch(`${EUW_BASE}/lol/league/v4/entries/by-puuid/${puuid}`);
    if (!leagueData || !Array.isArray(leagueData)) return null;

    const soloQ = leagueData.find(queue => queue.queueType === "RANKED_SOLO_5x5");
    return soloQ ? { tier: soloQ.tier, rank: soloQ.rank, lp: soloQ.leaguePoints, wins: soloQ.wins, losses: soloQ.losses } : null;
}

// --- 3. Match History & Timelines ---
/**
 * @param {string} queueType - "420" for SoloQ, "custom" for Prime League
 */
async function getRecentMatches(puuid, count = 10, queueType = 420) {
    // We now filter by queue type BEFORE downloading, saving massive amounts of API quota
    let url = `${REGION_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`;
    
    if (queueType === 420) url += `&queue=420`;
    if (queueType === 'custom') url += `&type=custom`;

    return await riotFetch(url);
}

async function getMatchData(matchId) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId}`);
}

async function getMatchTimeline(matchId) {
    return await riotFetch(`${REGION_BASE}/lol/match/v5/matches/${matchId}/timeline`);
}

module.exports = { getPUUID, getRankedData, getRecentMatches, getMatchData, getMatchTimeline };
