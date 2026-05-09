/**
 * src/core/analytics.js
 * Professionelle Esports-Analytics Engine mit Z-Score Normalisierung.
 * Baselines: Master+ Niveau
 */

// Mapping Riot's API roles to our internal teams.json schema
const RIOT_ROLE_MAP = {
    "TOP": "TOP",
    "JUNGLE": "JGL",
    "MIDDLE": "MID",
    "BOTTOM": "BOT",
    "UTILITY": "SUP",
    "JGL": "JGL", 
    "MID": "MID",
    "BOT": "BOT",
    "SUP": "SUP"
};

// Statistische Baselines für Master+ (m = Mittelwert, s = Standardabweichung)
const BASELINES = {
    TOP: { gd_15: { m: 0, s: 1500 }, dpg: { m: 1.2, s: 0.35 }, vspm: { m: 1.4, s: 0.5 }, cc: { m: 18, s: 12 }, kp: { m: 48, s: 10 }, obj: { m: 0.15, s: 0.08 }, hsp: { m: 1000, s: 1500 } },
    JGL: { gd_15: { m: 0, s: 1200 }, dpg: { m: 0.9, s: 0.25 }, vspm: { m: 2.2, s: 0.7 }, cc: { m: 28, s: 18 }, kp: { m: 65, s: 12 }, obj: { m: 0.45, s: 0.15 }, hsp: { m: 1500, s: 2000 } },
    MID: { gd_15: { m: 0, s: 1300 }, dpg: { m: 1.45, s: 0.4 }, vspm: { m: 1.5, s: 0.5 }, cc: { m: 20, s: 14 }, kp: { m: 58, s: 11 }, obj: { m: 0.15, s: 0.08 }, hsp: { m: 1000, s: 1500 } },
    BOT: { gd_15: { m: 0, s: 1600 }, dpg: { m: 1.65, s: 0.45 }, vspm: { m: 1.3, s: 0.4 }, cc: { m: 12, s: 8 },  kp: { m: 52, s: 10 }, obj: { m: 0.20, s: 0.10 }, hsp: { m: 500,  s: 800  } },
    SUP: { gd_15: { m: 0, s: 800 },  dpg: { m: 0.45, s: 0.2 }, vspm: { m: 3.8, s: 1.4 }, cc: { m: 40, s: 25 }, kp: { m: 68, s: 13 }, obj: { m: 0.05, s: 0.05 }, hsp: { m: 6000, s: 5000 } }
};

/**
 * Hilfsfunktion zum Begrenzen von Werten (Clamping)
 */
function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

/**
 * Normalisierung via Z-Score auf eine 0-100 Skala (50 = Durchschnitt)
 */
function normalize(val, baseline) {
    if (!baseline) return 50;
    const z = (val - baseline.m) / baseline.s;
    const n_raw = (z * 15) + 50;
    return clamp(n_raw, 0, 100);
}

/**
 * ENGINE 1: THE DISCORD GAMIFICATION CALCULATOR
 */
function calculateDiscordStats(targetPuuid, matchDataArray, timelineDataArray) {
    const validMatches = matchDataArray.filter(m => m && m.info && m.info.gameDuration > 300);
    if (validMatches.length === 0) return null;

    let gameScores = { ci: [], ti: [] };

    validMatches.forEach((match, idx) => {
        const info = match.info;
        const timeline = timelineDataArray[idx];
        const me = info.participants.find(p => p.puuid === targetPuuid);
        if (!me) return;

        // Role Mapping Fix
        const rawRiotPosition = me.teamPosition || "MIDDLE";
        const mappedRole = RIOT_ROLE_MAP[rawRiotPosition] || "MID"; 
        const bl = BASELINES[mappedRole] || BASELINES.MID;
        
        const gameMins = info.gameDuration / 60;

        // --- DATEN-EXTRAKTION ---
        const myTeam = info.participants.filter(p => p.teamId === me.teamId);
        const teamKills = myTeam.reduce((sum, p) => sum + p.kills, 0);
        const teamDamage = myTeam.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);
        const teamGold = myTeam.reduce((sum, p) => sum + p.goldEarned, 0);

        const dmgShare = me.totalDamageDealtToChampions / (teamDamage || 1);
        const goldShare = me.goldEarned / (teamGold || 1);
        const objDmgShare = me.damageDealtToObjectives / (info.participants.reduce((s, p) => s + p.damageDealtToObjectives, 0) || 1);

        // SICHERER GD@15 CHECK
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

        // --- NORMALIZED DATA EXTRACTION ---
        const n_gd15 = normalize(gd15, bl.gd_15);
        const n_dpg = normalize(me.totalDamageDealtToChampions / (me.goldEarned || 1), bl.dpg);
        const n_obj_dmg = normalize(objDmgShare, bl.obj); 
        
        const delta_econ = dmgShare - goldShare;
        const n_delta_econ = clamp((delta_econ + 0.05) * 1000, 0, 100); 

        // --- DYNAMIC CARRY INDEX (CI) ---
        let CI;
        if (mappedRole === "SUP") {
            CI = (0.50 * n_gd15) + (0.20 * n_delta_econ) + (0.10 * n_dpg) + (0.20 * n_obj_dmg);
        } else {
            CI = (0.30 * n_gd15) + (0.35 * n_delta_econ) + (0.20 * n_dpg) + (0.15 * n_obj_dmg);
        }

        // --- TACTICIAN INDEX (TI) REWORK ---
        // 1. Utility Flex Score (CC vs Heal/Shield)
        const healShield = (me.totalHealsOnTeammates || 0) + (me.totalDamageShieldedOnTeammates || 0);
        const n_cc = normalize(me.timeCCingOthers, bl.cc);
        const n_hsp = normalize(healShield, bl.hsp);
        const n_utility = Math.max(n_cc, n_hsp); 

        // 2. Kill Participation & Isolation Penalty
        const kp_pct = teamKills > 0 ? (me.kills + me.assists) / teamKills : 0;
        const iso_death_pct = me.deaths > 0 ? clamp((me.deaths - (me.assists * 0.5)) / me.deaths, 0, 1) : 0;
        const kp_adj = (kp_pct * 100) - (iso_death_pct * 25); 

        // 3. Final TI Calculation
        const TI = (0.15 * n_gd15) + 
                   (0.35 * normalize(me.visionScore / gameMins, bl.vspm)) + 
                   (0.30 * n_utility) + 
                   (0.20 * normalize(kp_adj, bl.kp));

        gameScores.ci.push(CI);
        gameScores.ti.push(TI);
    });

    if (gameScores.ci.length === 0) return null;

    const avgCI = Math.round(gameScores.ci.reduce((a, b) => a + b, 0) / gameScores.ci.length);
    const avgTI = Math.round(gameScores.ti.reduce((a, b) => a + b, 0) / gameScores.ti.length);

    return {
        carryIndex: clamp(avgCI, 0, 100),
        tacticianIndex: clamp(avgTI, 0, 100)
    };
}

/**
 * ENGINE 2: THE WEBSITE LEDGER (Scouting Tool)
 */
function calculateWebsiteLedger(targetPuuid, matchData, timelineData) {
    const info = matchData.info;
    const me = info.participants.find(p => p.puuid === targetPuuid);
    if (!me) return null;

    const rawRiotPosition = me.teamPosition || "MIDDLE";
    const mappedRole = RIOT_ROLE_MAP[rawRiotPosition] || "MID"; 
    
    const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);

    // SICHERER GD@15 CHECK
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
        role: mappedRole, // Gesäuberte Rolle für die Website
        win: me.win,
        kda: `${me.kills}/${me.deaths}/${me.assists}`,
        gd15: gd15,
        dmgShare: parseFloat(((me.totalDamageDealtToChampions / (info.participants.filter(p => p.teamId === me.teamId).reduce((s, p) => s + p.totalDamageDealtToChampions, 0) || 1)) * 100).toFixed(1)),
        enemyName: enemy ? (enemy.riotIdGameName || enemy.summonerName) : "Unknown"
    };
}

module.exports = { calculateDiscordStats, calculateWebsiteLedger };
