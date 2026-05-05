/**
 * src/core/analytics.js
 * The proprietary math engine for advanced Prime League metrics.
 */

function calculatePlayerStats(targetPuuid, matchData, timelineData) {
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

    // Advanced Metrics
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

    // Output formatted for the Website Ledger and Discord
    return {
        matchId: matchData.metadata.matchId,
        gameCreation: info.gameCreation, // Unix timestamp of when the game started
        champion: me.championName,
        role: myRole,
        win: me.win,
        kda: `${me.kills}/${me.deaths}/${me.assists}`,
        kp: kp,
        dmgPerGold: dmgPerGold,
        dmgShare: dmgShare,
        vspm: vspm,
        gd15: gd15,
        enemyName: enemy ? enemy.riotIdGameName : "Unknown"
    };
}

module.exports = { calculatePlayerStats };
