/**
 * src/core/analytics.js
 * Professionelle Esports-Analytics Engine mit Z-Score Normalisierung.
 * Baselines: Master+ Niveau
 */

const RIOT_ROLE_MAP = {
    "TOP": "TOP", "JUNGLE": "JGL", "MIDDLE": "MID", "BOTTOM": "BOT", "UTILITY": "SUP",
    "JGL": "JGL", "MID": "MID", "BOT": "BOT", "SUP": "SUP"
};

// Added 'dtp' (Damage Taken Percentage) for the purified Vanguard Index
const BASELINES = {
    TOP: { gd_15: { m: 0, s: 1500 }, dpg: { m: 1.2, s: 0.35 }, vspm: { m: 1.4, s: 0.5 }, cc: { m: 18, s: 12 }, kp: { m: 48, s: 10 }, obj: { m: 0.15, s: 0.08 }, hsp: { m: 1000, s: 1500 }, smd: { m: 25000, s: 10000 }, dt2d: { m: 4000, s: 1500 }, dtp: { m: 0.28, s: 0.05 } },
    JGL: { gd_15: { m: 0, s: 1200 }, dpg: { m: 0.9, s: 0.25 }, vspm: { m: 2.2, s: 0.7 }, cc: { m: 28, s: 18 }, kp: { m: 65, s: 12 }, obj: { m: 0.45, s: 0.15 }, hsp: { m: 1500, s: 2000 }, smd: { m: 20000, s: 8000 }, dt2d: { m: 3500, s: 1200 }, dtp: { m: 0.25, s: 0.05 } },
    MID: { gd_15: { m: 0, s: 1300 }, dpg: { m: 1.45, s: 0.4 }, vspm: { m: 1.5, s: 0.5 }, cc: { m: 20, s: 14 }, kp: { m: 58, s: 11 }, obj: { m: 0.15, s: 0.08 }, hsp: { m: 1000, s: 1500 }, smd: { m: 10000, s: 5000 }, dt2d: { m: 2500, s: 800 }, dtp: { m: 0.15, s: 0.04 } },
    BOT: { gd_15: { m: 0, s: 1600 }, dpg: { m: 1.65, s: 0.45 }, vspm: { m: 1.3, s: 0.4 }, cc: { m: 12, s: 8 },  kp: { m: 52, s: 10 }, obj: { m: 0.20, s: 0.10 }, hsp: { m: 500,  s: 800  }, smd: { m: 8000, s: 3000 }, dt2d: { m: 2000, s: 600 }, dtp: { m: 0.12, s: 0.03 } },
    SUP: { gd_15: { m: 0, s: 800 },  dpg: { m: 0.45, s: 0.2 }, vspm: { m: 3.8, s: 1.4 }, cc: { m: 40, s: 25 }, kp: { m: 68, s: 13 }, obj: { m: 0.05, s: 0.05 }, hsp: { m: 6000, s: 5000 }, smd: { m: 15000, s: 8000 }, dt2d: { m: 3000, s: 1000 }, dtp: { m: 0.20, s: 0.05 } }
};

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function normalize(val, baseline) {
    if (!baseline) return 50;
    const z = (val - baseline.m) / baseline.s;
    const n_raw = (z * 15) + 50;
    return clamp(n_raw, 0, 100);
}

function calculateDiscordStats(targetPuuid, matchDataArray, timelineDataArray, expectedRole) {
    const validMatches = [];
    const validTimelines = [];

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

    if (validMatches.length === 0) return null;

    let gameScores = { ups: [], ci: [], ti: [], vi: [] };
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
        const deathShare = me.deaths / (teamDeaths || 1);
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

        const n_gd15 = normalize(gd15, bl.gd_15);
        const n_dpg = normalize(me.totalDamageDealtToChampions / (me.goldEarned || 1), bl.dpg);
        const n_obj_dmg = normalize(objDmgShare, bl.obj); 
        const delta_econ = dmgShare - goldShare;
        const n_delta_econ = clamp((delta_econ + 0.05) * 1000, 0, 100); 

        // 1. CARRY INDEX (CI) - The Sword
        let CI = (0.30 * n_gd15) + (0.35 * n_delta_econ) + (0.20 * n_dpg) + (0.15 * n_obj_dmg);

        // 2. TACTICIAN INDEX (TI) - The Brain
        const healShield = (me.totalHealsOnTeammates || 0) + (me.totalDamageShieldedOnTeammates || 0);
        const primaryUtility = Math.max(normalize(me.timeCCingOthers, bl.cc), normalize(healShield, bl.hsp));
        const secondaryUtility = Math.min(normalize(me.timeCCingOthers, bl.cc), normalize(healShield, bl.hsp));
        const blendedUtility = (0.6 * primaryUtility) + (0.4 * secondaryUtility);

        const kp_pct = teamKills > 0 ? (me.kills + me.assists) / teamKills : 0;
        const iso_death_pct = me.deaths > 0 ? clamp((me.deaths - (me.assists * 0.5)) / me.deaths, 0, 1) : 0;
        const kp_adj = (kp_pct * 100) - (iso_death_pct * 25); 

        let TI = (0.40 * normalize(me.visionScore / gameMins, bl.vspm)) + (0.35 * blendedUtility) + (0.25 * normalize(kp_adj, bl.kp));

        // 3. VANGUARD INDEX (VI) - The Shield
        const perfectMultiplier = me.deaths === 0 ? 1.5 : 1.0;
        const dt2d = (me.totalDamageTaken * perfectMultiplier) / (me.deaths || 1);
        let VI = (0.35 * normalize(me.damageSelfMitigated, bl.smd)) + (0.35 * normalize(dt2d, bl.dt2d)) + (0.30 * normalize(dmgTakenShare, bl.dtp));

        // ROLE-SPECIFIC UPS WEIGHTING
        let UPS_Raw = 0;
        if (expectedRole === "TOP") {
            UPS_Raw = (0.35 * CI) + (0.25 * TI) + (0.40 * VI);
        } else if (expectedRole === "JGL") {
            UPS_Raw = (0.25 * CI) + (0.45 * TI) + (0.30 * VI);
        } else if (expectedRole === "MID") {
            UPS_Raw = (0.45 * CI) + (0.35 * TI) + (0.20 * VI);
        } else if (expectedRole === "SUP") {
            UPS_Raw = (0.15 * CI) + (0.60 * TI) + (0.25 * VI);
        } else if (expectedRole === "BOT") {
            UPS_Raw = (0.65 * CI) + (0.35 * TI) + (0.00 * VI); // ADCs are immune to Vanguard metrics
        }

        // GLOBAL PENALTY (Supports Exempt)
        let globalPenalty = 1.0;
        if (expectedRole !== "SUP") {
            if (deathShare > (goldShare + 0.15)) globalPenalty = 0.85; 
            else if (deathShare > (goldShare + 0.05)) globalPenalty = 0.95; 
        }

        let UPS = UPS_Raw * globalPenalty;

        gameScores.ci.push(CI);
        gameScores.ti.push(TI);
        gameScores.vi.push(VI);
        gameScores.ups.push(UPS);
    });

    if (gameScores.ups.length === 0) return null;

    const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    return { 
        ups: clamp(avg(gameScores.ups), 0, 100),
        ci: clamp(avg(gameScores.ci), 0, 100), 
        ti: clamp(avg(gameScores.ti), 0, 100),
        vi: clamp(avg(gameScores.vi), 0, 100)
    };
}

function calculateWebsiteLedger(targetPuuid, matchData, timelineData) {
    const info = matchData.info;
    const me = info.participants.find(p => p.puuid === targetPuuid);
    if (!me) return null;

    const rawRiotPosition = me.teamPosition || "MIDDLE";
    const mappedRole = RIOT_ROLE_MAP[rawRiotPosition] || "MID"; 
    const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);

    let gd15 = 0;
    if (timelineData && timelineData.info && timelineData.info.frames && timelineData.info.frames.length > 15) {
        const frame15 = timelineData.info.frames[15];
        if (frame15 && frame15.participantFrames) {
            const myG = frame15.participantFrames[me.participantId.toString()]?.totalGold || 0;
            const enG = enemy ? (frame15.participantFrames[enemy.participantId.toString()]?.totalGold || myG) : myG;
            gd15 = myG - enG;
        }
    }

    return {
        matchId: matchData.metadata.matchId,
        gameCreation: info.gameCreation,
        champion: me.championName,
        role: mappedRole,
        win: me.win,
        kda: `${me.kills}/${me.deaths}/${me.assists}`,
        gd15: gd15,
        dmgShare: parseFloat(((me.totalDamageDealtToChampions / (info.participants.filter(p => p.teamId === me.teamId).reduce((s, p) => s + p.totalDamageDealtToChampions, 0) || 1)) * 100).toFixed(1)),
        enemyName: enemy ? (enemy.riotIdGameName || enemy.summonerName) : "Unknown"
    };
}

module.exports = { calculateDiscordStats, calculateWebsiteLedger };
