/**
 * src/core/analytics.js
 * The High-Quality Statistical Engine for UIC.
 * Focus: Role-Normalized ROI (Return on Investment).
 */

const RIOT_ROLE_MAP = {
    "TOP": "TOP", "JUNGLE": "JGL", "MIDDLE": "MID", "BOTTOM": "BOT", "UTILITY": "SUP",
    "JGL": "JGL", "MID": "MID", "BOT": "BOT", "SUP": "SUP"
};

/**
 * MASTER+ BASELINES (μ = Mean, σ = StdDev)
 * These constants represent the expected performance of a Master Tier player.
 */
const BASELINES = {
    TOP: { 
        gd15: { m: 0, s: 1300 }, dpg: { m: 1.2, s: 0.35 }, vspm: { m: 1.4, s: 0.5 }, 
        tower: { m: 4500, s: 2000 }, abs: { m: 2.2, s: 0.8 }, mit: { m: 1.8, s: 0.7 }, 
        kp15: { m: 0.35, s: 0.15 }, kp: { m: 45, s: 12 }, deaths: { m: 5.0, s: 2.2 } 
    },
    JGL: { 
        gd15: { m: 0, s: 1100 }, dpg: { m: 0.9, s: 0.25 }, vspm: { m: 2.2, s: 0.7 }, 
        kp: { m: 65, s: 12 }, abs: { m: 1.8, s: 0.6 }, mit: { m: 1.2, s: 0.5 }, 
        kp15: { m: 0.55, s: 0.20 }, deaths: { m: 4.8, s: 2.0 } 
    },
    MID: { 
        gd15: { m: 0, s: 1200 }, dpg: { m: 1.45, s: 0.4 }, vspm: { m: 1.5, s: 0.5 }, 
        kp: { m: 58, s: 11 }, deaths: { m: 4.5, s: 2.0 }, dmgShare: { m: 0.26, s: 0.08 } 
    },
    BOT: { 
        gd15: { m: 0, s: 1500 }, dpg: { m: 1.65, s: 0.45 }, vspm: { m: 1.3, s: 0.4 }, 
        kp: { m: 52, s: 10 }, deaths: { m: 4.2, s: 1.8 }, dmgShare: { m: 0.30, s: 0.10 } 
    },
    SUP: { 
        gd15: { m: 0, s: 700 }, dpg: { m: 0.45, s: 0.2 }, vspm: { m: 3.8, s: 1.4 }, 
        utility: { m: 40, s: 20 }, abs: { m: 1.5, s: 0.7 }, mit: { m: 1.0, s: 0.5 }, 
        kp15: { m: 0.45, s: 0.18 }, kp: { m: 60, s: 15 }, deaths: { m: 5.5, s: 2.5 } 
    }
};

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

/**
 * Normalizes a raw value into a 0-100 score based on Master+ baselines.
 */
function normalize(val, baseline) {
    if (!baseline) return 50;
    const z = (val - baseline.m) / baseline.s;
    const n_raw = (z * 15) + 50; // 50 is the baseline center
    return clamp(n_raw, 0, 100);
}

/**
 * Performance Optimized: Extracts all required 15-minute stats in one pass.
 */
function getTimelineStats(timeline, participantId, enemyParticipantId) {
    const stats = { gd15: 0, kp15: 0 };
    if (!timeline || !timeline.info || !timeline.info.frames) return stats;

    const frame15 = timeline.info.frames[15] || timeline.info.frames[timeline.info.frames.length - 1];
    
    if (frame15 && frame15.participantFrames) {
        const myGold = frame15.participantFrames[participantId]?.totalGold || 0;
        const enGold = frame15.participantFrames[enemyParticipantId]?.totalGold || myGold;
        stats.gd15 = myGold - enGold;
    }

    // Extract Kill Participation at 15m
    let killsAt15 = 0;
    for (let i = 0; i <= 15 && i < timeline.info.frames.length; i++) {
        const events = timeline.info.frames[i].events || [];
        events.forEach(e => {
            if (e.type === "CHAMPION_KILL" && (e.killerId === participantId || (e.assistingParticipantIds || []).includes(participantId))) {
                killsAt15++;
            }
        });
    }
    stats.kp15 = killsAt15;
    return stats;
}

/**
 * ENGINE: ROLE-NORMALIZED ANALYTICS
 */
function calculateIndices(targetPuuid, matchData, timelineData, assignedRole) {
    const info = matchData.info;
    const me = info.participants.find(p => p.puuid === targetPuuid);
    if (!me || info.gameDuration <= 300) return null;

    const role = assignedRole || RIOT_ROLE_MAP[me.teamPosition] || "MID";
    const bl = BASELINES[role] || BASELINES.MID;
    const gameMins = info.gameDuration / 60;
    
    // Team Resources
    const team = info.participants.filter(p => p.teamId === me.teamId);
    const teamKills = team.reduce((s, p) => s + p.kills, 0);
    const teamDmg = team.reduce((s, p) => s + p.totalDamageDealtToChampions, 0);
    const teamGold = team.reduce((s, p) => s + p.goldEarned, 0);
    const goldShare = me.goldEarned / (teamGold || 1);

    // Timeline Data
    const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);
    const tStats = getTimelineStats(timelineData, me.participantId, enemy?.participantId);

    // 1. CARRY INDEX (CI) - Converting Gold to Pressure
    const n_dpg = normalize(me.totalDamageDealtToChampions / (me.goldEarned || 1), bl.dpg);
    const n_gd15 = normalize(tStats.gd15, bl.gd15);
    let CI = 50;

    if (["BOT", "MID"].includes(role)) {
        const n_share = normalize(me.totalDamageDealtToChampions / (teamDmg || 1), bl.dmgShare);
        CI = (0.4 * n_dpg) + (0.3 * n_gd15) + (0.3 * n_share);
    } else if (role === "TOP") {
        const n_tower = normalize(me.damageDealtToBuildings, bl.tower);
        CI = (0.3 * n_dpg) + (0.4 * n_gd15) + (0.3 * n_tower);
    } else {
        CI = (0.5 * n_dpg) + (0.5 * n_gd15);
    }

    // 2. TACTICIAN INDEX (TI) - Awareness & Utility
    const n_vspm = normalize(me.visionScore / gameMins, bl.vspm);
    const kp_pct = teamKills > 0 ? (me.kills + me.assists) / teamKills : 0;
    let TI = 50;

    if (["SUP", "JGL"].includes(role)) {
        const n_util = normalize(me.timeCCingOthers, bl.utility);
        TI = (0.5 * n_vspm) + (0.3 * n_util) + (0.2 * normalize(kp_pct * 100, bl.kp));
    } else {
        const n_survival = normalize(10 - me.deaths, { m: 10 - bl.deaths.m, s: bl.deaths.s });
        TI = (0.2 * n_vspm) + (0.4 * normalize(kp_pct * 100, bl.kp)) + (0.4 * n_survival);
    }

    // 3. VANGUARD INDEX (VI) - Space Creation (Frontliners only)
    let VI = 0;
    if (["TOP", "JGL", "SUP"].includes(role)) {
        const n_abs = normalize(me.totalDamageTaken / (goldShare * 100), bl.abs);
        const n_mit = normalize(me.damageSelfMitigated / gameMins, bl.mit);
        const n_kp15 = normalize(tStats.kp15, bl.kp15);
        VI = (0.4 * n_abs) + (0.3 * n_mit) + (0.3 * n_kp15);
    }

    return { 
        ci: Math.round(CI), 
        ti: Math.round(TI), 
        vi: Math.round(VI),
        details: { gd15: tStats.gd15, dpg: (me.totalDamageDealtToChampions / me.goldEarned).toFixed(2) }
    };
}

/**
 * REPOSITORY B SOURCE: Generates the forensic JSON for the website.
 */
function calculateWebsiteLedger(targetPuuid, matchData, timelineData, assignedRole) {
    const indices = calculateIndices(targetPuuid, matchData, timelineData, assignedRole);
    if (!indices) return null;

    const me = matchData.info.participants.find(p => p.puuid === targetPuuid);
    const enemy = matchData.info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);

    return {
        matchId: matchData.metadata.matchId,
        timestamp: matchData.info.gameCreation,
        champion: me.championName,
        role: assignedRole || RIOT_ROLE_MAP[me.teamPosition] || "MID",
        win: me.win,
        kda: `${me.kills}/${me.deaths}/${me.assists}`,
        indices: indices,
        opponent: enemy ? (enemy.riotIdGameName || enemy.summonerName) : "Unknown"
    };
}

module.exports = { calculateIndices, calculateWebsiteLedger };
