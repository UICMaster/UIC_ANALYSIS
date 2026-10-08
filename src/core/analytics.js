/**
 * src/core/analytics.js
 * Raw Data Extractor - Pure SoloQ Discord Dashboard Edition
 * Computes all 8 metrics with a true 10-game sliding window.
 */

const RIOT_ROLE_MAP = {
    "TOP": "TOP", "JUNGLE": "JGL", "MIDDLE": "MID", "BOTTOM": "BOT", "UTILITY": "SUP",
    "JGL": "JGL", "MID": "MID", "BOT": "BOT", "SUP": "SUP"
};

function calculateDiscordStats(targetPuuid, matchDataArray, timelineDataArray, expectedRole, cachedState = {}) {
    const validMatches = [];
    const validTimelines = [];

    // 1. Filter valid matches (SoloQ 5v5 queue=420, assigned role, duration > 5 mins)
    matchDataArray.forEach((m, idx) => {
        if (!m || !m.info || m.info.gameDuration <= 300) return;
        if (m.info.queueId !== 420) return;

        const me = m.info.participants.find(p => p.puuid === targetPuuid);
        if (!me) return;

        const rawRiotPosition = me.teamPosition || "MIDDLE";
        const mappedRole = RIOT_ROLE_MAP[rawRiotPosition] || "MID";

        if (mappedRole === expectedRole) {
            validMatches.push(m);
            validTimelines.push(timelineDataArray[idx]);
        }
    });

    // 2. Clone or initialize history arrays
    const requiredKeys = ['csd14', 'gd15', 'dpg', 'kp', 'vspm', 'kda', 'dpm', 'csm'];
    let history = cachedState && cachedState.history
        ? JSON.parse(JSON.stringify(cachedState.history))
        : {};

    for (const key of requiredKeys) {
        if (!Array.isArray(history[key])) {
            history[key] = [];
        }
    }

    // 3. Fallback check: If no new valid SoloQ role matches were found
    if (validMatches.length === 0) {
        if (history.gd15.length === 0) return null;
        return { averages: cachedState.averages, history: history };
    }

    // 4. Extract metrics in chronological order (oldest of the batch -> newest)
    validMatches.reverse().forEach((match, idx) => {
        const info = match.info;
        const timeline = validTimelines[idx];
        const me = info.participants.find(p => p.puuid === targetPuuid);
        const gameMins = info.gameDuration / 60;

        const myTeam = info.participants.filter(p => p.teamId === me.teamId);
        const teamKills = myTeam.reduce((sum, p) => sum + p.kills, 0);

        let csd14 = 0;
        let gd15 = 0;

        if (timeline && timeline.info && Array.isArray(timeline.info.frames)) {
            const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);
            if (enemy && me.teamPosition) {
                const f14 = timeline.info.frames[14];
                if (f14 && f14.participantFrames) {
                    const myF14 = f14.participantFrames[me.participantId.toString()];
                    const enF14 = f14.participantFrames[enemy.participantId.toString()];
                    if (myF14 && enF14) {
                        const myCS = (myF14.minionsKilled || 0) + (myF14.jungleMinionsKilled || 0);
                        const enCS = (enF14.minionsKilled || 0) + (enF14.jungleMinionsKilled || 0);
                        csd14 = myCS - enCS;
                    }
                }

                const f15 = timeline.info.frames[15];
                if (f15 && f15.participantFrames) {
                    const myTotalGold = f15.participantFrames[me.participantId.toString()]?.totalGold || 0;
                    const enTotalGold = f15.participantFrames[enemy.participantId.toString()]?.totalGold || 0;
                    gd15 = myTotalGold - enTotalGold;
                }
            }
        }

        const deaths = me.deaths === 0 ? 1 : me.deaths;

        history.csd14.push(csd14);
        history.gd15.push(gd15);
        history.dpg.push(me.totalDamageDealtToChampions / (me.goldEarned || 1));
        history.kp.push(teamKills > 0 ? ((me.kills + me.assists) / teamKills) * 100 : 0);
        history.vspm.push(me.visionScore / gameMins);
        history.kda.push((me.kills + me.assists) / deaths);
        history.dpm.push(me.totalDamageDealtToChampions / gameMins);
        history.csm.push(((me.totalMinionsKilled || 0) + (me.neutralMinionsKilled || 0)) / gameMins);
    });

    // 5. Trim sliding window to strictly the last 10 games
    for (const key of requiredKeys) {
        history[key] = history[key].slice(-10);
    }

    // 6. Compute true arithmetic averages
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const averages = {
        csd14: avg(history.csd14),
        gd15: avg(history.gd15),
        dpg: avg(history.dpg),
        kp: avg(history.kp),
        vspm: avg(history.vspm),
        kda: avg(history.kda),
        dpm: avg(history.dpm),
        csm: avg(history.csm)
    };

    return { averages, history };
}

module.exports = { calculateDiscordStats };
