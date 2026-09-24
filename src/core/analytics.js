/**
 * src/core/analytics.js
 * Raw Data Extractor - Pure SoloQ Discord Dashboard Edition
 */

const RIOT_ROLE_MAP = {
    "TOP": "TOP", "JUNGLE": "JGL", "MIDDLE": "MID", "BOTTOM": "BOT", "UTILITY": "SUP",
    "JGL": "JGL", "MID": "MID", "BOT": "BOT", "SUP": "SUP"
};

function calculateDiscordStats(targetPuuid, matchDataArray, timelineDataArray, expectedRole, cachedState = null) {
    const deltaResult = calculateRawMetrics(targetPuuid, matchDataArray, timelineDataArray, expectedRole);
    
    if (!deltaResult) return null;

    const newMetrics = deltaResult.metrics;
    const newCount = deltaResult.count;
    const ROLLING_WINDOW = 10; 

    if (!cachedState || cachedState.gd15 === undefined || newCount >= ROLLING_WINDOW) {
        return newMetrics;
    }

    const oldWeight = ROLLING_WINDOW - newCount;

    // Weighted moving average for pure raw stats
    return {
        gd14: ((cachedState.gd14 || 0) * oldWeight + (newMetrics.gd14 * newCount)) / ROLLING_WINDOW,
        gd15: ((cachedState.gd15 || 0) * oldWeight + (newMetrics.gd15 * newCount)) / ROLLING_WINDOW,
        dpg: ((cachedState.dpg || 0) * oldWeight + (newMetrics.dpg * newCount)) / ROLLING_WINDOW,
        kp: ((cachedState.kp || 0) * oldWeight + (newMetrics.kp * newCount)) / ROLLING_WINDOW,
        vspm: ((cachedState.vspm || 0) * oldWeight + (newMetrics.vspm * newCount)) / ROLLING_WINDOW,
        hsp: ((cachedState.hsp || 0) * oldWeight + (newMetrics.hsp * newCount)) / ROLLING_WINDOW,
        dmgMitigated: ((cachedState.dmgMitigated || 0) * oldWeight + (newMetrics.dmgMitigated * newCount)) / ROLLING_WINDOW
    };
}

function calculateRawMetrics(targetPuuid, matchDataArray, timelineDataArray, expectedRole) {
    const validMatches = [];
    const validTimelines = [];

    matchDataArray.forEach((m, idx) => {
        if (!m || !m.info || m.info.gameDuration <= 300) return;
        if (m.info.queueId !== 420) return; 

        const me = m.info.participants.find(p => p.puuid === targetPuuid);
        if (!me) return;

        const rawRiotPosition = me.teamPosition || "MIDDLE";
        const mappedRole = RIOT_ROLE_MAP[rawRiotPosition] || "MID"; 
        
        if (mappedRole === expectedRole && validMatches.length < 10) {
            validMatches.push(m);
            validTimelines.push(timelineDataArray[idx]);
        }
    });

    if (validMatches.length === 0) return null;

    let stats = { gd14: [], gd15: [], dpg: [], kp: [], vspm: [], hsp: [], dmgMitigated: [] };

    validMatches.forEach((match, idx) => {
        const info = match.info;
        const timeline = validTimelines[idx];
        const me = info.participants.find(p => p.puuid === targetPuuid);
        const gameMins = info.gameDuration / 60;

        const myTeam = info.participants.filter(p => p.teamId === me.teamId);
        const teamKills = myTeam.reduce((sum, p) => sum + p.kills, 0);

        let gd14 = 0;
        let gd15 = 0;
        if (timeline && timeline.info && timeline.info.frames) {
            const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);
            if (enemy) {
                const frame14 = timeline.info.frames[14];
                if (frame14 && frame14.participantFrames) {
                    gd14 = (frame14.participantFrames[me.participantId.toString()]?.totalGold || 0) - 
                           (frame14.participantFrames[enemy.participantId.toString()]?.totalGold || 0);
                }
                const frame15 = timeline.info.frames[15];
                if (frame15 && frame15.participantFrames) {
                    gd15 = (frame15.participantFrames[me.participantId.toString()]?.totalGold || 0) - 
                           (frame15.participantFrames[enemy.participantId.toString()]?.totalGold || 0);
                }
            }
        }

        const dpg = me.totalDamageDealtToChampions / (me.goldEarned || 1);
        const kp_pct = teamKills > 0 ? ((me.kills + me.assists) / teamKills) * 100 : 0;
        const vspm = me.visionScore / gameMins;
        const hsp = (me.totalHealsOnTeammates || 0) + (me.totalDamageShieldedOnTeammates || 0);
        const dmgMitigated = me.damageSelfMitigated || 0;

        stats.gd14.push(gd14);
        stats.gd15.push(gd15);
        stats.dpg.push(dpg);
        stats.kp.push(kp_pct);
        stats.vspm.push(vspm);
        stats.hsp.push(hsp);
        stats.dmgMitigated.push(dmgMitigated);
    });

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
        metrics: {
            gd14: avg(stats.gd14),
            gd15: avg(stats.gd15),
            dpg: avg(stats.dpg),
            kp: avg(stats.kp),
            vspm: avg(stats.vspm),
            hsp: avg(stats.hsp),
            dmgMitigated: avg(stats.dmgMitigated)
        },
        count: validMatches.length 
    };
}

module.exports = { calculateDiscordStats };
