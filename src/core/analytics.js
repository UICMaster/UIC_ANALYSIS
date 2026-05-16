/**
 * src/core/analytics.js
 * Professionelle Esports-Analytics Engine mit Z-Score Normalisierung.
 * OVR (Overall Value Rating) Framework: Laning, Combat, Macro, Survivability.
 * Bias Fixed: Role-Relative Economy Delta, Survival Share Normalization, Balanced Top Weights.
 * Baselines: Master+ Niveau
 */

const RIOT_ROLE_MAP = {
    "TOP": "TOP", "JUNGLE": "JGL", "MIDDLE": "MID", "BOTTOM": "BOT", "UTILITY": "SUP",
    "JGL": "JGL", "MID": "MID", "BOT": "BOT", "SUP": "SUP"
};

// Added 'de' (Delta Economy) and 'ss' (Survival Share) to fix SoloQ role biases.
const BASELINES = {
    TOP: { gd_15: { m: 0, s: 1500 }, dpg: { m: 1.2, s: 0.35 }, de: { m: 0.02, s: 0.05 }, ss: { m: 0.80, s: 0.08 }, vspm: { m: 1.4, s: 0.5 }, cc: { m: 18, s: 12 }, kp: { m: 48, s: 10 }, obj: { m: 0.15, s: 0.08 }, hsp: { m: 1000, s: 1500 }, smd: { m: 25000, s: 10000 }, dt2d: { m: 4000, s: 1500 }, dtp: { m: 0.28, s: 0.05 } },
    JGL: { gd_15: { m: 0, s: 1200 }, dpg: { m: 0.9, s: 0.25 }, de: { m: -0.04, s: 0.05 }, ss: { m: 0.80, s: 0.08 }, vspm: { m: 2.2, s: 0.7 }, cc: { m: 28, s: 18 }, kp: { m: 65, s: 12 }, obj: { m: 0.45, s: 0.15 }, hsp: { m: 1500, s: 2000 }, smd: { m: 20000, s: 8000 }, dt2d: { m: 3500, s: 1200 }, dtp: { m: 0.25, s: 0.05 } },
    MID: { gd_15: { m: 0, s: 1300 }, dpg: { m: 1.45, s: 0.4 }, de: { m: 0.06, s: 0.05 }, ss: { m: 0.78, s: 0.08 }, vspm: { m: 1.5, s: 0.5 }, cc: { m: 20, s: 14 }, kp: { m: 58, s: 11 }, obj: { m: 0.15, s: 0.08 }, hsp: { m: 1000, s: 1500 }, smd: { m: 10000, s: 5000 }, dt2d: { m: 2500, s: 800 }, dtp: { m: 0.15, s: 0.04 } },
    BOT: { gd_15: { m: 0, s: 1600 }, dpg: { m: 1.65, s: 0.45 }, de: { m: 0.08, s: 0.05 }, ss: { m: 0.82, s: 0.08 }, vspm: { m: 1.3, s: 0.4 }, cc: { m: 12, s: 8 },  kp: { m: 52, s: 10 }, obj: { m: 0.20, s: 0.10 }, hsp: { m: 500,  s: 800  }, smd: { m: 8000, s: 3000 }, dt2d: { m: 2000, s: 600 }, dtp: { m: 0.12, s: 0.03 } },
    SUP: { gd_15: { m: 0, s: 800 },  dpg: { m: 0.45, s: 0.2 }, de: { m: -0.10, s: 0.05 }, ss: { m: 0.80, s: 0.08 }, vspm: { m: 3.8, s: 1.4 }, cc: { m: 40, s: 25 }, kp: { m: 68, s: 13 }, obj: { m: 0.05, s: 0.05 }, hsp: { m: 6000, s: 5000 }, smd: { m: 15000, s: 8000 }, dt2d: { m: 3000, s: 1000 }, dtp: { m: 0.20, s: 0.05 } }
};

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function normalize(val, baseline) {
    if (!baseline) return 50;
    const z = (val - baseline.m) / baseline.s;
    const n_raw = (z * 15) + 50;
    return clamp(n_raw, 0, 100);
}

// ==========================================
// DISCORD ENGINE: OVR FRAMEWORK
// ==========================================
function calculateDiscordStats(targetPuuid, matchDataArray, timelineDataArray, expectedRole) {
    const validMatches = [];
    const validTimelines = [];

    matchDataArray.forEach((m, idx) => {
        if (!m || !m.info || m.info.gameDuration <= 300) return;
        if (m.info.queueId !== 420) return; // Strict SoloQ restriction

        const me = m.info.participants.find(p => p.puuid === targetPuuid);
        if (!me) return;

        const rawRiotPosition = me.teamPosition || "MIDDLE";
        const mappedRole = RIOT_ROLE_MAP[rawRiotPosition] || "MID"; 
        
        if (mappedRole === expectedRole) {
            // Guarantee maximum of 10 tracked games
            if (validMatches.length < 10) {
                validMatches.push(m);
                validTimelines.push(timelineDataArray[idx]);
            }
        }
    });

    if (validMatches.length === 0) return null;

    let gameScores = { ovr: [], laning: [], combat: [], macro: [], survivability: [] };
    const bl = BASELINES[expectedRole] || BASELINES.MID;

    validMatches.forEach((match, idx) => {
        const info = match.info;
        const timeline = validTimelines[idx];
        const me = info.participants.find(p => p.puuid === targetPuuid);
        const gameMins = info.gameDuration / 60;

        const myTeam = info.participants.filter(p => p.teamId === me.teamId);
        const teamKills = myTeam.reduce((sum, p) => sum + p.kills, 0);
        const teamDeaths = myTeam.reduce((sum, p) => sum + p.deaths, 0);
        const teamDamage = myTeam.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);
        const teamGold = myTeam.reduce((sum, p) => sum + p.goldEarned, 0);
        const teamDamageTaken = myTeam.reduce((sum, p) => sum + p.totalDamageTaken, 0);

        const dmgShare = me.totalDamageDealtToChampions / (teamDamage || 1);
        const goldShare = me.goldEarned / (teamGold || 1);
        const dmgTakenShare = me.totalDamageTaken / (teamDamageTaken || 1);
        const objDmgShare = me.damageDealtToObjectives / (info.participants.reduce((s, p) => s + p.damageDealtToObjectives, 0) || 1);

        let gd15 = 0;
        if (timeline && timeline.info && timeline.info.frames && timeline.info.frames.length > 15) {
            const frame15 = timeline.info.frames[15];
            const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);
            if (enemy && frame15 && frame15.participantFrames) {
                const myG = frame15.participantFrames[me.participantId.toString()]?.totalGold || 0;
                const enG = frame15.participantFrames[enemy.participantId.toString()]?.totalGold || 0;
                gd15 = myG - enG;
            }
        }

        // --- 1. LANING Pillar ---
        let Laning = normalize(gd15, bl.gd_15);

        // --- 2. COMBAT Pillar ---
        const delta_econ = dmgShare - goldShare;
        const n_delta_econ = normalize(delta_econ, bl.de);
        const n_dpg = normalize(me.totalDamageDealtToChampions / (me.goldEarned || 1), bl.dpg);
        const kp_pct = teamKills > 0 ? (me.kills + me.assists) / teamKills : 0;
        
        let Combat = (0.40 * n_delta_econ) + (0.35 * n_dpg) + (0.25 * normalize(kp_pct * 100, bl.kp));

        // --- 3. MACRO Pillar ---
        const healShield = (me.totalHealsOnTeammates || 0) + (me.totalDamageShieldedOnTeammates || 0);
        const primaryUtility = Math.max(normalize(me.timeCCingOthers, bl.cc), normalize(healShield, bl.hsp));
        const secondaryUtility = Math.min(normalize(me.timeCCingOthers, bl.cc), normalize(healShield, bl.hsp));
        const blendedUtility = (0.6 * primaryUtility) + (0.4 * secondaryUtility);

        let Macro = (0.45 * normalize(me.visionScore / gameMins, bl.vspm)) + (0.35 * blendedUtility) + (0.20 * normalize(objDmgShare, bl.obj));

        // --- 4. SURVIVABILITY Pillar ---
        const dt2d_adj = me.totalDamageTaken / (me.deaths + 1); // Laplace smoothing
        const survival_share = clamp(1 - (me.deaths / (teamDeaths || 1)), 0, 1);
        const positioning_score = normalize(survival_share, bl.ss); // Fixed raw inflation

        let Survivability = (0.35 * normalize(me.damageSelfMitigated, bl.smd)) + 
                            (0.35 * normalize(dt2d_adj, bl.dt2d)) + 
                            (0.30 * positioning_score);

        // --- ROLE-SPECIFIC PRO OVR WEIGHTING ---
        let OVR = 0;
        if (expectedRole === "TOP") {
            OVR = (0.30 * Laning) + (0.30 * Combat) + (0.15 * Macro) + (0.25 * Survivability); // Top Bias Fixed
        } else if (expectedRole === "JGL") {
            OVR = (0.15 * Laning) + (0.25 * Combat) + (0.35 * Macro) + (0.25 * Survivability);
        } else if (expectedRole === "MID") {
            OVR = (0.25 * Laning) + (0.35 * Combat) + (0.25 * Macro) + (0.15 * Survivability);
        } else if (expectedRole === "BOT") {
            OVR = (0.30 * Laning) + (0.45 * Combat) + (0.10 * Macro) + (0.15 * Survivability);
        } else if (expectedRole === "SUP") {
            OVR = (0.15 * Laning) + (0.15 * Combat) + (0.50 * Macro) + (0.20 * Survivability);
        }

        gameScores.laning.push(Laning);
        gameScores.combat.push(Combat);
        gameScores.macro.push(Macro);
        gameScores.survivability.push(Survivability);
        gameScores.ovr.push(OVR);
    });

    if (gameScores.ovr.length === 0) return null;

    const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    return { 
        ovr: clamp(avg(gameScores.ovr), 0, 100),
        laning: clamp(avg(gameScores.laning), 0, 100), 
        combat: clamp(avg(gameScores.combat), 0, 100),
        macro: clamp(avg(gameScores.macro), 0, 100),
        survivability: clamp(avg(gameScores.survivability), 0, 100)
    };
}

// ==========================================
// WEBSITE ENGINE: RAW STATS DATABASE
// ==========================================
function calculateWebsiteLedger(targetPuuid, matchData, timelineData) {
    const info = matchData.info;
    const me = info.participants.find(p => p.puuid === targetPuuid);
    if (!me) return null;

    const rawRiotPosition = me.teamPosition || "MIDDLE";
    const mappedRole = RIOT_ROLE_MAP[rawRiotPosition] || "MID"; 
    const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);

    const myTeam = info.participants.filter(p => p.teamId === me.teamId);
    const teamDamage = myTeam.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);
    const teamGold = myTeam.reduce((sum, p) => sum + p.goldEarned, 0);
    const teamDamageTaken = myTeam.reduce((sum, p) => sum + p.totalDamageTaken, 0);
    const teamKills = myTeam.reduce((sum, p) => sum + p.kills, 0);

    let gd15 = 0;
    if (timelineData && timelineData.info && timelineData.info.frames && timelineData.info.frames.length > 15) {
        const frame15 = timelineData.info.frames[15];
        if (frame15 && frame15.participantFrames) {
            const myG = frame15.participantFrames[me.participantId.toString()]?.totalGold || 0;
            const enG = enemy ? (frame15.participantFrames[enemy.participantId.toString()]?.totalGold || myG) : myG;
            gd15 = myG - enG;
        }
    }

    // Returns purely factual, unmodified raw stats for your website interface
    return {
        matchId: matchData.metadata.matchId,
        gameCreation: info.gameCreation,
        champion: me.championName,
        role: mappedRole,
        win: me.win,
        kills: me.kills,
        deaths: me.deaths,
        assists: me.assists,
        kp: teamKills > 0 ? parseFloat((((me.kills + me.assists) / teamKills) * 100).toFixed(1)) : 0,
        gd15: gd15,
        dmgShare: parseFloat(((me.totalDamageDealtToChampions / (teamDamage || 1)) * 100).toFixed(1)),
        goldShare: parseFloat(((me.goldEarned / (teamGold || 1)) * 100).toFixed(1)),
        dmgTakenShare: parseFloat(((me.totalDamageTaken / (teamDamageTaken || 1)) * 100).toFixed(1)),
        vspm: parseFloat((me.visionScore / (info.gameDuration / 60)).toFixed(2)),
        dpm: parseFloat((me.totalDamageDealtToChampions / (info.gameDuration / 60)).toFixed(1)),
        smd: me.damageSelfMitigated,
        enemyName: enemy ? (enemy.riotIdGameName || enemy.summonerName) : "Unknown"
    };
}

module.exports = { calculateDiscordStats, calculateWebsiteLedger };
