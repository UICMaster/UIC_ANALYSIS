/**
 * src/api/prime.js
 * Professional Prime League API integration with 48-Hour Rolling Window logic.
 */

async function fetchPrimeData(teamsData) {
    console.log("📡 [Prime API] Constructing 48-Hour Scouting Reports...");
    
    const baseUrl = process.env.PRIME_API_URL;
    if (!baseUrl) {
        console.error("❌ PRIME_API_URL is missing!");
        return [];
    }

    let activeScoutingReports = [];
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    for (const [teamKey, teamInfo] of Object.entries(teamsData)) {
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
            
            // Rolling Window: Captures all matches 24 hours in the past and 24 hours in the future.
            const relevantMatches = (primeData.matches || []).filter(m => {
                if (!m.begin) return false;
                const matchTime = new Date(m.begin).getTime();
                return matchTime >= (now - TWENTY_FOUR_HOURS) && matchTime <= (now + TWENTY_FOUR_HOURS);
            });

            for (const match of relevantMatches) {
                let enemyStarters = [];
                let myStarters = [];
                let isPredicted = false;

                if (match.team_lineup && match.team_lineup.length > 0) {
                    myStarters = match.team_lineup.map(p => p.summoner_name);
                } else {
                    myStarters = teamInfo.roster
                        .filter(p => p.trackStats && p.rosterStatus === "starter")
                        .map(p => `${p.gameName}#${p.tagLine}`);
                }

                if (match.enemy_lineup && match.enemy_lineup.length > 0) {
                    enemyStarters = match.enemy_lineup.map(p => p.summoner_name);
                } else if (match.enemy_team && match.enemy_team.id) {
                    isPredicted = true;
                    try {
                        const enemyRes = await fetch(`${baseUrl}/api/v1/teams/${match.enemy_team.id}/`, { 
                            headers: { 'Accept': 'application/json' } 
                        });
                        if (enemyRes.ok) {
                            const enemyData = await enemyRes.json();
                            // Pass the ENTIRE enemy roster to guarantee subs are caught
                            enemyStarters = (enemyData.players || []).map(p => p.summoner_name);
                        }
                    } catch (err) {
                        console.log(`   ⚠️ [Prime] Failed to fetch enemy roster prediction for ${match.enemy_team.name}`);
                    }
                }

                // Strip legacy #TagLines from Prime API names
                const normalizeId = (name) => name ? name.split('#')[0].trim() : "";

                activeScoutingReports.push({
                    myTeam: teamKey,
                    teamDisplay: teamInfo.teamDisplay,
                    enemyTeamName: match.enemy_team ? match.enemy_team.name : "Unknown",
                    matchTime: match.begin,
                    myStarters: myStarters.map(normalizeId),
                    enemyStarters: enemyStarters.map(normalizeId),
                    isPredicted: isPredicted,
                    matchId: match.match_id
                });
            }

        } catch (error) {
            console.error(`❌ [Prime] Error processing ${teamKey}:`, error.message);
        }
    }
    
    console.log(`   ✅ [Prime] Active Window: Found ${activeScoutingReports.length} matches within 48h.`);
    return activeScoutingReports;
}

module.exports = { fetchPrimeData };
