/**
 * src/core/analytics.js
 * The proprietary math engine for calculating advanced Prime League metrics.
 */

/**
 * Takes raw Riot Match and Timeline data and extracts our core metrics for a specific player.
 * 
 * @param {string} targetPuuid - The PUUID of the player we are analyzing
 * @param {object} matchData - The raw JSON from Riot Match-V5
 * @param {object} timelineData - The raw JSON from Riot Timeline-V5
 * @returns {object} Clean, formatted object of advanced stats
 */
function calculatePlayerStats(targetPuuid, matchData, timelineData) {
    console.log(`🧠 [Analytics] Crunching numbers for PUUID: ${targetPuuid.substring(0, 8)}...`);

    const info = matchData.info;
    
    // 1. Locate our target player in the match
    const me = info.participants.find(p => p.puuid === targetPuuid);
    if (!me) {
        console.error(`❌ Player not found in match data!`);
        return null;
    }

    const myTeamId = me.teamId;
    const myRole = me.teamPosition; // "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"
    const myParticipantId = me.participantId; // Number 1-10

    // 2. Locate the enemy lane opponent
    const enemy = info.participants.find(p => p.teamId !== myTeamId && p.teamPosition === myRole);
    const enemyParticipantId = enemy ? enemy.participantId : null;

    // 3. Calculate Team Totals (Needed for Percentages)
    const myTeam = info.participants.filter(p => p.teamId === myTeamId);
    const teamTotalKills = myTeam.reduce((sum, p) => sum + p.kills, 0);
    const teamTotalDamage = myTeam.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);

    // Riot Match-V5 gameDuration is measured in seconds. Convert to minutes.
    const gameMinutes = info.gameDuration / 60;

    // ---------------------------------------------------------
    // THE MATH: CORE METRICS
    // ---------------------------------------------------------

    // Kill Participation (KP%)
    const kpRaw = teamTotalKills > 0 ? ((me.kills + me.assists) / teamTotalKills) * 100 : 0;
    const kp = parseFloat(kpRaw.toFixed(1));

    // Damage-to-Gold Ratio
    const dmgPerGoldRaw = me.goldEarned > 0 ? (me.totalDamageDealtToChampions / me.goldEarned) : 0;
    const dmgPerGold = parseFloat(dmgPerGoldRaw.toFixed(2));

    // Damage Share (%)
    const dmgShareRaw = teamTotalDamage > 0 ? (me.totalDamageDealtToChampions / teamTotalDamage) * 100 : 0;
    const dmgShare = parseFloat(dmgShareRaw.toFixed(1));

    // Vision Score Per Minute (VSPM)
    const vspmRaw = gameMinutes > 0 ? (me.visionScore / gameMinutes) : 0;
    const vspm = parseFloat(vspmRaw.toFixed(2));

    // Gold Difference at 15 Minutes (GD@15)
    let gd15 = 0;
    
    // Check if timeline exists, enemy exists, and the game actually lasted 15 minutes
    if (timelineData && enemyParticipantId && timelineData.info.frames.length > 15) {
        // Frame index 15 represents exactly 15:00
        const frame15 = timelineData.info.frames[15]; 
        
        if (frame15 && frame15.participantFrames) {
            // Riot keys the participant frames by a string ID ("1", "2", etc.)
            const myGold = frame15.participantFrames[myParticipantId.toString()].totalGold;
            const enemyGold = frame15.participantFrames[enemyParticipantId.toString()].totalGold;
            gd15 = myGold - enemyGold;
        }
    } else if (timelineData && timelineData.info.frames.length <= 15) {
        console.log(`⚠️ Game ended before 15 minutes. GD@15 will be 0.`);
    }

    // ---------------------------------------------------------
    // THE OUTPUT FORMAT
    // ---------------------------------------------------------
    return {
        champion: me.championName,
        role: myRole,
        win: me.win,
        kda: `${me.kills}/${me.deaths}/${me.assists}`,
        kills: me.kills,
        deaths: me.deaths,
        assists: me.assists,
        kp: kp,
        dmgPerGold: dmgPerGold,
        dmgShare: dmgShare,
        vspm: vspm,
        gd15: gd15,
        matchDuration: parseFloat(gameMinutes.toFixed(1))
    };
}

/**
 * Aggregates an array of individual match stats into an average profile for a player.
 */
function calculateAverages(statsArray) {
    if (!statsArray || statsArray.length === 0) return null;

    const totalGames = statsArray.length;
    let sumKp = 0, sumDmgGold = 0, sumDmgShare = 0, sumVspm = 0, sumGd15 = 0;
    let wins = 0;

    statsArray.forEach(stat => {
        sumKp += stat.kp;
        sumDmgGold += stat.dmgPerGold;
        sumDmgShare += stat.dmgShare;
        sumVspm += stat.vspm;
        sumGd15 += stat.gd15;
        if (stat.win) wins++;
    });

    return {
        gamesPlayed: totalGames,
        winRate: parseFloat(((wins / totalGames) * 100).toFixed(1)),
        avgKp: parseFloat((sumKp / totalGames).toFixed(1)),
        avgDmgPerGold: parseFloat((sumDmgGold / totalGames).toFixed(2)),
        avgDmgShare: parseFloat((sumDmgShare / totalGames).toFixed(1)),
        avgVspm: parseFloat((sumVspm / totalGames).toFixed(2)),
        avgGd15: Math.round(sumGd15 / totalGames) // Round to whole number for Gold
    };
}

module.exports = { calculatePlayerStats, calculateAverages };
