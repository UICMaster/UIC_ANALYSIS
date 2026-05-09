/**
 * src/api/prime.js
 * Handles interactions with the Prime League Bot API.
 * Refactored for Lineup-Accurate Scouting.
 */

const { fetchWithRetry } = require('../utils/network');

async function fetchPrimeData(teamsData) {
    console.log("📡 [Prime API] Checking schedule for active teams...");
    
    const baseUrl = process.env.PRIME_API_URL;
    if (!baseUrl) {
        console.error("❌ PRIME_API_URL is missing!");
        return [];
    }

    let activeScoutingReports = [];

    for (const [teamKey, teamInfo] of Object.entries(teamsData)) {
        if (teamKey === "community" || !teamInfo.primeLeagueId) continue;

        try {
            // 1. Fetch Team Profile to find the schedule
            const teamRes = await fetchWithRetry(`${baseUrl}/api/v1/teams/${teamInfo.primeLeagueId}/`, { 
                headers: { 'Accept': 'application/json' } 
            });
            
            if (teamRes.status !== 200 || !teamRes.data) {
                console.log(`   ⚠️ [Prime] Could not fetch team profile for ${teamInfo.teamDisplay}`);
                continue;
            }

            // 2. Find the next unfinished match
            const upcomingMatches = (teamRes.data.matches || [])
                .filter(m => !m.result || m.result === "")
                .sort((a, b) => new Date(a.begin) - new Date(b.begin));

            if (upcomingMatches.length === 0) continue;
            const nextMatchMeta = upcomingMatches[0];

            // 3. ✨ NEW: Fetch the specific MATCH details to get exact lineups
            const matchRes = await fetchWithRetry(`${baseUrl}/api/v1/matches/${nextMatchMeta.match_id}/`, {
                headers: { 'Accept': 'application/json' }
            });

            if (matchRes.status !== 200 || !matchRes.data) continue;
            const matchDetail = matchRes.data;

            let enemyStarters = [], myStarters = [], isPredicted = false;

            // 4. Extract Lineups (With Fallbacks)
            if (matchDetail.team_lineup && matchDetail.team_lineup.length > 0) {
                myStarters = matchDetail.team_lineup.map(p => p.summoner_name);
            } else {
                // Fallback to our local database starters
                myStarters = teamInfo.roster
                    .filter(p => p.trackStats && p.rosterStatus === "starter")
                    .map(p => `${p.gameName}#${p.tagLine}`);
            }

            if (matchDetail.enemy_lineup && matchDetail.enemy_lineup.length > 0) {
                enemyStarters = matchDetail.enemy_lineup.map(p => p.summoner_name);
            } else {
                isPredicted = true;
                // If the enemy hasn't locked in, we fallback to their general roster profile
                const enemyRes = await fetchWithRetry(`${baseUrl}/api/v1/teams/${matchDetail.enemy_team.id}/`, { 
                    headers: { 'Accept': 'application/json' } 
                });
                if (enemyRes.status === 200 && enemyRes.data) {
                    enemyStarters = (enemyRes.data.players || []).slice(0, 5).map(p => p.summoner_name);
                }
            }

            activeScoutingReports.push({
                myTeam: teamKey,
                teamDisplay: teamInfo.teamDisplay,
                enemyTeamName: matchDetail.enemy_team.name,
                matchTime: matchDetail.begin,
                myStarters: myStarters,
                enemyStarters: enemyStarters,
                isPredicted: isPredicted,
                matchId: matchDetail.match_id
            });

        } catch (error) {
            console.error(`❌ [Prime] Error processing ${teamKey}:`, error.message);
        }
    }
    
    console.log(`   ✅ [Prime] Found ${activeScoutingReports.length} upcoming matches.`);
    return activeScoutingReports;
}

module.exports = { fetchPrimeData };
