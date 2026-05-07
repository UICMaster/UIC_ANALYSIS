/**
 * src/core/analytics.js
 * Professionelle Esports-Analytics Engine mit Z-Score Normalisierung.
 * Baselines: Master+ Niveau
 */

// Statistische Baselines für Master+ (m = Mittelwert, s = Standardabweichung)
const BASELINES = {
    TOP: { gd_15: { m: 0, s: 1500 }, dpg: { m: 1.2, s: 0.35 }, vspm: { m: 1.4, s: 0.5 }, cc: { m: 18, s: 12 }, kp: { m: 48, s: 10 } },
    JGL: { gd_15: { m: 0, s: 1200 }, dpg: { m: 0.9, s: 0.25 }, vspm: { m: 2.2, s: 0.7 }, cc: { m: 28, s: 18 }, kp: { m: 65, s: 12 } },
    MID: { gd_15: { m: 0, s: 1300 }, dpg: { m: 1.45, s: 0.4 }, vspm: { m: 1.5, s: 0.5 }, cc: { m: 20, s: 14 }, kp: { m: 58, s: 11 } },
    BOT: { gd_15: { m: 0, s: 1600 }, dpg: { m: 1.65, s: 0.45 }, vspm: { m: 1.3, s: 0.4 }, cc: { m: 12, s: 8 },  kp: { m: 52, s: 10 } },
    SUP: { gd_15: { m: 0, s: 800 },  dpg: { m: 0.45, s: 0.2 }, vspm: { m: 3.8, s: 1.4 }, cc: { m: 40, s: 25 }, kp: { m: 68, s: 13 } }
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

        const role = me.teamPosition || "MID"; 
        const bl = BASELINES[role] || BASELINES.MID;
        const gameMins = info.gameDuration / 60;

        // --- DATEN-EXTRAKTION ---
        const myTeam = info.participants.filter(p => p.teamId === me.teamId);
        const teamKills = myTeam.reduce((sum, p) => sum + p.kills, 0);
        const teamDamage = myTeam.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);
        const teamGold = myTeam.reduce((sum, p) => sum + p.goldEarned, 0);

        const dmgShare = me.totalDamageDealtToChampions / teamDamage;
        const goldShare = me.goldEarned / teamGold;
        const objDmgShare = me.damageDealtToObjectives / (info.participants.reduce((s, p) => s + p.damageDealtToObjectives, 0) || 1);

        // GD@15 Berechnung
        let gd15 = 0;
        if (timeline && timeline.info.frames[15]) {
            const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === me.teamPosition);
            if (enemy) {
                const myG = timeline.info.frames[15].participantFrames[me.participantId].totalGold;
                const enG = timeline.info.frames[15].participantFrames[enemy.participantId].totalGold;
                gd15 = myG - enG;
            }
        }

        // --- CARRY INDEX (CI) ---
        const n_gd15 = normalize(gd15, bl.gd_15);
        const n_dpg = normalize(me.totalDamageDealtToChampions / (me.goldEarned || 1), bl.dpg);
        
        const delta_econ = dmgShare - goldShare;
        const n_delta_econ = clamp((delta_econ + 0.05) * 1000, 0, 100);
        const n_obj_dmg = clamp(objDmgShare * 100, 0, 100);

        const CI = (0.30 * n_gd15) + (0.40 * n_delta_econ) + (0.15 * n_dpg) + (0.15 * n_obj_dmg);

        // --- TACTICIAN INDEX (TI) ---
        const kp_pct = teamKills > 0 ? (me.kills + me.assists) / teamKills : 0;
        // Proxy für Isolated Deaths (Deaths ohne Kill-Beteiligung des Teams)
        const iso_death_pct = me.deaths > 0 ? clamp((me.deaths - (me.assists * 0.5)) / me.deaths, 0, 1) : 0;
        const kp_adj = (kp_pct * 100) - (iso_death_pct * 10); // Skalierte Adjustierung

        const TI = (0.20 * n_gd15) + 
                   (0.30 * normalize(me.visionScore / gameMins, bl.vspm)) + 
                   (0.30 * normalize(me.timeCCingOthers, bl.cc)) + 
                   (0.20 * normalize(kp_adj, bl.kp));

        gameScores.ci.push(CI);
        gameScores.ti.push(TI);
    });

    // Durchschnitt über alle Spiele bilden
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

    const myRole = me.teamPosition; 
    const enemy = info.participants.find(p => p.teamId !== me.teamId && p.teamPosition === myRole);

    let gd15 = 0;
    if (timelineData && timelineData.info.frames[15]) {
        const myG = timelineData.info.frames[15].participantFrames[me.participantId].totalGold;
        const enG = enemy ? timelineData.info.frames[15].participantFrames[enemy.participantId].totalGold : myG;
        gd15 = myG - enG;
    }

    return {
        matchId: matchData.metadata.matchId,
        gameCreation: info.gameCreation,
        champion: me.championName,
        role: myRole,
        win: me.win,
        kda: `${me.kills}/${me.deaths}/${me.assists}`,
        gd15: gd15,
        dmgShare: parseFloat(((me.totalDamageDealtToChampions / info.participants.filter(p => p.teamId === me.teamId).reduce((s, p) => s + p.totalDamageDealtToChampions, 0)) * 100).toFixed(1)),
        enemyName: enemy ? (enemy.riotIdGameName || enemy.summonerName) : "Unknown"
    };
}

module.exports = { calculateDiscordStats, calculateWebsiteLedger };
