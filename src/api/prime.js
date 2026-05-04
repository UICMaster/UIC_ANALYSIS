/**
 * src/api/prime.js
 * Handles all interactions with the Prime League Bot API.
 */

async function fetchPrimeData(teamsData) {
    console.log("📡 [Prime API] Checking schedule for all teams...");
    
    // Pull the base URL from your GitHub Secrets / .env file
    const baseUrl = process.env.PRIME_API_URL;
    if (!baseUrl) {
        console.error("❌ PRIME_API_URL is missing in environment variables!");
        return [];
    }

    const headers = {
        'Accept': 'application/json',
        // 'Authorization': `Bearer ${process.env.PRIME_API_TOKEN}` // Uncomment if your bot requires a token
    };

    let activeScoutingReports = [];

    // Loop through every team in your teams.json
    for (const [teamKey, teamInfo] of Object.entries(teamsData)) {
        try {
            // 1. Fetch our team's schedule
            const url = `${baseUrl}/api/v1/teams/${teamInfo.primeLeagueId}/`;
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                console.error(`⚠️ [Prime API] Failed to fetch team ${teamKey} (Status: ${response.status})`);
                continue;
            }

            const primeData = await response.json();
            
            // 2. Find the next unplayed match
            // We filter out games that have a result, and sort by date to get the closest upcoming game
            const upcomingMatches = primeData.matches
                .filter(m => !m.result || m.result === "")
                .sort((a, b) => new Date(a.begin) - new Date(b.begin));

            if (upcomingMatches.length === 0) {
                console.log(`💤 No upcoming matches found for ${teamKey.toUpperCase()}.`);
                continue; // Skip to the next team
            }

            const nextMatch = upcomingMatches[0];
            
            let enemyStarters = [];
            let myStarters = [];
            let isPredicted = false;

            // 3. Grab OUR locked roster (Fallback to teams.json if we haven't locked yet)
            if (nextMatch.team_lineup && nextMatch.team_lineup.length > 0) {
                myStarters = nextMatch.team_lineup.map(p => p.summoner_name);
            } else {
                myStarters = teamInfo.roster.filter(p => p.trackStats).map(p => `${p.gameName}#${p.tagLine}`);
            }

            // 4. Grab ENEMY locked roster
            if (nextMatch.enemy_lineup && nextMatch.enemy_lineup.length > 0) {
                enemyStarters = nextMatch.enemy_lineup.map(p => p.summoner_name);
            } else {
                // THE FALLBACK: Enemy hasn't locked. We predict their roster.
                console.log(`⚠️ Enemy lineup not locked for ${teamKey} vs ${nextMatch.enemy_team.name}. Predicting roster...`);
                isPredicted = true;
                
                try {
                    const enemyTeamUrl = `${baseUrl}/api/v1/teams/${nextMatch.enemy_team.id}/`;
                    const enemyRes = await fetch(enemyTeamUrl, { headers });
                    if (enemyRes.ok) {
                        const enemyData = await enemyRes.json();
                        // Grab up to 5 players from their registered roster
                        enemyStarters = enemyData.players.slice(0, 5).map(p => p.summoner_name);
                    }
                } catch (err) {
                    console.error(`Failed to fetch predicted enemy roster: ${err.message}`);
                }
            }

            console.log(`⚔️ Match Queued: ${teamKey.toUpperCase()} vs ${nextMatch.enemy_team.name} | Roster Locked: ${!isPredicted}`);

            // 5. Package the data for Phase 2 (Riot API)
            activeScoutingReports.push({
                myTeam: teamKey,
                enemyTeamName: nextMatch.enemy_team.name,
                matchTime: nextMatch.begin, // ISO String timestamp
                myStarters: myStarters,     // Array of "Name#Tag" strings
                enemyStarters: enemyStarters, // Array of "Name#Tag" strings
                isPredicted: isPredicted,
                matchId: nextMatch.match_id
            });

        } catch (error) {
            console.error(`❌ [Prime API] Error processing ${teamKey}:`, error.message);
        }
    }

    return activeScoutingReports;
}

module.exports = { fetchPrimeData };
