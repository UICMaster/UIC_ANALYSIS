/**
 * src/api/prime.js
 * Handles all interactions with the Prime League Bot API.
 */

async function fetchPrimeData(teamsData) {
    console.log("📡 [Prime API] Checking schedule for active teams...");
    
    const baseUrl = process.env.PRIME_API_URL;
    if (!baseUrl) {
        console.error("❌ PRIME_API_URL is missing!");
        return [];
    }

    let activeScoutingReports = [];

    for (const [teamKey, teamInfo] of Object.entries(teamsData)) {
        // 1. SKIP COMMUNITY & TEAMS WITHOUT IDS
        if (teamKey === "community" || !teamInfo.primeLeagueId || teamInfo.primeLeagueId === "") {
            continue;
        }

        try {
            const response = await fetch(`${baseUrl}/api/v1/teams/${teamInfo.primeLeagueId}/`, { 
                headers: { 'Accept': 'application/json' } 
            });
            
            if (!response.ok) {
                console.log(`   ⚠️ [Prime] Could not fetch data for ${teamInfo.teamDisplay}`);
                continue;
            }

            const primeData = await response.json();
            
            // 2. FIND THE NEXT UNFINISHED MATCH
            const upcomingMatches = (primeData.matches || [])
                .filter(m => !m.result || m.result === "")
                .sort((a, b) => new Date(a.begin) - new Date(b.begin));

            if (upcomingMatches.length === 0) continue;

            const nextMatch = upcomingMatches[0];
            let enemyStarters = [], myStarters = [], isPredicted = false;

            // 3. PROCESS MY ROSTER (Locked vs. Fallback)
            if (nextMatch.team_lineup && nextMatch.team_lineup.length > 0) {
                myStarters = nextMatch.team_lineup.map(p => p.summoner_name);
            } else {
                // Fallback to our teams.json Starters
                myStarters = teamInfo.roster
                    .filter(p => p.trackStats && p.rosterStatus === "starter")
                    .map(p => `${p.gameName}#${p.tagLine}`);
            }

            // 4. PROCESS ENEMY ROSTER (Locked vs. Prediction)
            if (nextMatch.enemy_lineup && nextMatch.enemy_lineup.length > 0) {
                enemyStarters = nextMatch.enemy_lineup.map(p => p.summoner_name);
            } else {
                isPredicted = true;
                try {
                    // Try to fetch the enemy team's general roster as a prediction
                    const enemyRes = await fetch(`${baseUrl}/api/v1/teams/${nextMatch.enemy_team.id}/`, { 
                        headers: { 'Accept': 'application/json' } 
                    });
                    if (enemyRes.ok) {
                        const enemyData = await enemyRes.json();
                        enemyStarters = (enemyData.players || []).slice(0, 5).map(p => p.summoner_name);
                    }
                } catch (err) {
                    console.log(`   ⚠️ [Prime] Failed to fetch enemy roster prediction for ${nextMatch.enemy_team.name}`);
                }
            }

            activeScoutingReports.push({
                myTeam: teamKey,
                teamDisplay: teamInfo.teamDisplay,
                enemyTeamName: nextMatch.enemy_team.name,
                matchTime: nextMatch.begin,
                myStarters: myStarters,
                enemyStarters: enemyStarters,
                isPredicted: isPredicted,
                matchId: nextMatch.match_id
            });

        } catch (error) {
            console.error(`❌ [Prime] Error processing ${teamKey}:`, error.message);
        }
    }
    
    console.log(`   ✅ [Prime] Found ${activeScoutingReports.length} upcoming matches across all divisions.`);
    return activeScoutingReports;
}

module.exports = { fetchPrimeData };
