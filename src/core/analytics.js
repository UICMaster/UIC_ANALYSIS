/**
 * src/core/analytics.js
 * The proprietary math engine divided into Discord Gamification and Website Analytics.
 */

/**
 * ---------------------------------------------------------------------------
 * ENGINE 1: THE DISCORD GAMIFICATION CALCULATOR
 * Analyzes up to 10 SoloQ matches to generate a "Form" score.
 * ---------------------------------------------------------------------------
 */
function calculateDiscordStats(targetPuuid, matchDataArray) {
    // Filter out null matches and Remakes (games under 5 minutes) so stats don't tank
    const validMatches = matchDataArray.filter(m => m && m.info && m.info.gameDuration > 300);
    
    if (validMatches.length === 0) return null;

    let totals = {
        kills: 0, assists: 0, teamKills: 0,
        damage: 0, teamDamage: 0, gold: 0,
        vision: 0, minutes: 0, wins: 0
    };

    validMatches.forEach(match => {
        const info = match.info;
        const me = info.participants.find(p => p.puuid === targetPuuid);
        if (!me) return;

        const myTeam = info.participants.filter(p => p.teamId === me.teamId);
        const teamKills = myTeam.reduce((sum, p) => sum + p.kills, 0);
        const teamDamage = myTeam.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);
        const gameMins = info.gameDuration / 60;

        totals.kills += me.kills;
        totals.assists += me.assists;
        totals.teamKills += teamKills;
        totals.damage += me.totalDamageDealtToChampions;
        totals.teamDamage += teamDamage;
        totals.gold += me.goldEarned;
        totals.vision += me.visionScore;
        totals.minutes += gameMins;
        if (me.win) totals.wins += 1;
    });

    // Calculate Averages Across the 10 Games
    const kp = totals.teamKills > 0 ? ((totals.kills + totals.assists) / totals.teamKills) * 100 : 0;
    const dpm = totals.minutes > 0 ? totals.damage / totals.minutes : 0;
    const dpg = totals.gold > 0 ? totals.damage / totals.gold : 0;
    const dmgShare = totals.teamDamage > 0 ? (totals.damage / totals.teamDamage) * 100 : 0;
    const vspm = totals.minutes > 0 ? totals.vision / totals.minutes : 0;
    const winRate = Math.round((totals.wins / validMatches.length) * 100);

    // THE PROPRIETARY FORMULA (Normalized to 100 = Average)
    // Carry: DPM (Baseline 600), Dmg Share (Baseline 25%), DPG (Baseline 1.3)
    const carryIndex = Math.round(((dpm / 600) * 0.4 + (dmgShare / 25) * 0.3 + (dpg / 1.3) * 0.3) * 100);
    
    // Tactician: KP (Baseline 50%), VSPM (Baseline 1.5)
    const tacticianIndex = Math.round(((kp / 50) * 0.5 + (vspm / 1.5) * 0.5) * 100);

    return {
        gamesPlayed: validMatches.length,
        winRate: winRate,
        kp: parseFloat(kp.toFixed(1)),
        dpm: Math.round(dpm),
        dpg: parseFloat(dpg.toFixed(2)),
        dmgShare: parseFloat(dmgShare.toFixed(1)),
        vspm: parseFloat(vspm.toFixed(2)),
        carryIndex: carryIndex,
        tacticianIndex: tacticianIndex
    };
}

/**
 * ---------------------------------------------------------------------------
 * ENGINE 2: THE WEBSITE LEDGER (PRIME LEAGUE MATCHES ONLY)
 * Deep scouting metrics requiring Timeline API (GD@15).
 * ---------------------------------------------------------------------------
 */
function calculateWebsiteLedger(targetPuuid, matchData, timelineData) {
    const info = matchData.info;
    const me = info.participants.find(p => p.puuid === targetPuuid);
    if (!me) return null;

    const myTeamId = me.teamId;
    const myRole = me.teamPosition; 
    const myParticipantId = me.participantId; 

    const enemy = info.participants.find(p => p.teamId !== myTeamId && p.teamPosition === myRole);
    const enemyParticipantId = enemy ? enemy.participantId : null;

    const myTeam = info.participants.filter(p => p.teamId === myTeamId);
    const teamTotalKills = myTeam.reduce((sum, p) => sum + p.kills, 0);
    const teamTotalDamage = myTeam.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);
    const gameMinutes = info.gameDuration / 60;

    const kp = teamTotalKills > 0 ? parseFloat((((me.kills + me.assists) / teamTotalKills) * 100).toFixed(1)) : 0;
    const dmgPerGold = me.goldEarned > 0 ? parseFloat((me.totalDamageDealtToChampions / me.goldEarned).toFixed(2)) : 0;
    const dmgShare = teamTotalDamage > 0 ? parseFloat(((me.totalDamageDealtToChampions / teamTotalDamage) * 100).toFixed(1)) : 0;
    const vspm = gameMinutes > 0 ? parseFloat((me.visionScore / gameMinutes).toFixed(2)) : 0;

    let gd15 = 0;
    if (timelineData && enemyParticipantId && timelineData.info.frames.length > 15) {
        const frame15 = timelineData.info.frames[15]; 
        if (frame15 && frame15.participantFrames) {
            const myGold = frame15.participantFrames[myParticipantId.toString()].totalGold;
            const enemyGold = frame15.participantFrames[enemyParticipantId.toString()].totalGold;
            gd15 = myGold - enemyGold;
        }
    }

    return {
        matchId: matchData.metadata.matchId,
        gameCreation: info.gameCreation,
        champion: me.championName,
        role: myRole,
        win: me.win,
        kda: `${me.kills}/${me.deaths}/${me.assists}`,
        kp: kp,
        dmgPerGold: dmgPerGold,
        dmgShare: dmgShare,
        vspm: vspm,
        gd15: gd15,
        enemyName: enemy ? (enemy.riotIdGameName || enemy.summonerName) : "Unknown"
    };
}

module.exports = { calculateDiscordStats, calculateWebsiteLedger };
