/**
 * src/discord/messages.js
 * Formats and delivers the analytical leaderboards and dashboards to Discord.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_BASE = 'https://discord.com/api/v10';

const CH_LP = process.env.DISCORD_CH_LP;
const CH_LEADERBOARD = process.env.DISCORD_CH_LEADERBOARD;
const CH_OVERVIEW = process.env.DISCORD_CH_OVERVIEW;

const UIC_COLOR = 0x00F0FF; 

const RANK_EMOJIS = {
    "CHALLENGER": "<:challenger:1501324978321101021>", "GRANDMASTER": "<:grandmaster:1501325107128434748>", "MASTER": "<:master:1501325178993512478>",
    "DIAMOND": "<:diamond:1501325003671601224>", "EMERALD": "<:emerald:1501325048219304039>", "PLATINUM": "<:platinum:1501325207330095104>",
    "GOLD": "<:gold:1501325080960172072>", "SILVER": "<:silver:1501325230868529345>", "BRONZE": "<:bronze:1501324928606146761>",
    "IRON": "<:iron:1501325151466422282>", "UNRANKED": "<:unranked:1501325256227553362>"
};

async function discordFetch(endpoint, method = 'GET', body = null, retries = 3) {
    if (!BOT_TOKEN) return null;
    if (retries <= 0) return null;

    const options = { method, headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        if (response.status === 429) {
            const errorData = await response.json();
            await new Promise(res => setTimeout(res, errorData.retry_after * 1000));
            return discordFetch(endpoint, method, body, retries - 1);
        }
        if (!response.ok) return null;
        
        const text = await response.text();
        return text ? JSON.parse(text) : true;
    } catch (error) {
        return null;
    }
}

async function updateOrPostMessage(channelId, embeds) {
    if (!channelId || embeds.length === 0) return;

    const embedChunks = [];
    for (let i = 0; i < embeds.length; i += 3) {
        embedChunks.push(embeds.slice(i, i + 3));
    }

    const messages = await discordFetch(`/channels/${channelId}/messages?limit=100`);
    if (!messages) return; 

    const botMessages = messages.filter(m => 
        m.author.bot && m.embeds?.[0]?.footer?.text?.includes("Bereitgestellt durch UIC")
    ).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

    for (let i = 0; i < Math.max(embedChunks.length, botMessages.length); i++) {
        const payload = { embeds: embedChunks[i] };
        if (i < embedChunks.length && i < botMessages.length) {
            await discordFetch(`/channels/${channelId}/messages/${botMessages[i].id}`, 'PATCH', payload);
        } else if (i < embedChunks.length) {
            await discordFetch(`/channels/${channelId}/messages`, 'POST', payload);
        } else {
            await discordFetch(`/channels/${channelId}/messages/${botMessages[i].id}`, 'DELETE');
        }
    }
}

// ----------------- LP LEADERBOARD -----------------
function getRankScore(tier, rank, lp) {
    const tiers = { "CHALLENGER": 90000, "GRANDMASTER": 80000, "MASTER": 70000, "DIAMOND": 60000, "EMERALD": 50000, "PLATINUM": 40000, "GOLD": 30000, "SILVER": 20000, "BRONZE": 10000, "IRON": 0, "UNRANKED": 0 };
    const ranks = { "I": 4000, "II": 3000, "III": 2000, "IV": 1000 };
    const numericLp = lp === null || lp === undefined || isNaN(lp) ? 0 : parseInt(lp);
    return (tiers[tier] || 0) + (ranks[rank] || 0) + numericLp;
}

const capitalize = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

async function postRankingsEmbeds(channelId, title, column3Name, data, formatCallback) {
    let embeds = [];
    const chunkSize = 15; 

    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        let colSpieler = "", colTeam = "", colWertung = "";

        chunk.forEach((player, index) => {
            const rank = i + index + 1;
            const row = formatCallback(player, rank);
            colSpieler += row.spieler + "\n";
            colTeam += row.team + "\n";
            colWertung += row.wertung + "\n";
        });

        embeds.push({
            title: i === 0 ? title : `${title} (Fortsetzung)`,
            color: UIC_COLOR,
            fields: [
                { name: "Spieler", value: colSpieler || "-", inline: true },
                { name: "Team", value: colTeam || "-", inline: true },
                { name: column3Name, value: colWertung || "-", inline: true }
            ],
            footer: { text: "Bereitgestellt durch UIC" },
            timestamp: new Date().toISOString()
        });
    }
    await updateOrPostMessage(channelId, embeds);
}

async function updateLpLeaderboard(data) {
    if (!CH_LP || data.length === 0) return;
    data.sort((a, b) => getRankScore(b.tier, b.rank, b.lp) - getRankScore(a.tier, a.rank, a.lp));
    
    await postRankingsEmbeds(CH_LP, "UIC Rangliste SoloQ/DuoQ", "Rang & LP", data, (p, rank) => {
        const emoji = RANK_EMOJIS[p.tier] || RANK_EMOJIS["UNRANKED"];
        return {
            spieler: `**${rank}.** ${p.gameName}#${p.tagLine}`,
            team: p.team || "-",
            wertung: `${emoji}${p.tier ? capitalize(p.tier) : "Unranked"} ${p.rank ? p.rank : ""} ${p.lp !== undefined ? `(${p.lp} LP)` : ""}`.trim()
        };
    });
    console.log(`   ✅ [Discord] Updated LP Leaderboard`);
}

// ----------------- RAW TEAM STATS DASHBOARD -----------------
async function updateTeamStatsBoard(teamStatsData) {
    if (!CH_LEADERBOARD || teamStatsData.length === 0) return;
    
    let embeds = [];
    const roleOrder = ["TOP", "JGL", "MID", "BOT", "SUP"];

    const formatRank = (rankData) => {
        if (!rankData || !rankData.tier) return "Unranked";
        const tier = rankData.tier.charAt(0).toUpperCase() + rankData.tier.slice(1).toLowerCase();
        return `${tier} ${rankData.rank \vert{}\vert{} ""} (${rankData.lp !== undefined ? rankData.lp : 0} LP)`.trim();
    };

    const formatVal = (val, isPlus = false) => {
        const num = Math.round(val);
        return (isPlus && num > 0) ? `+${num}` : `${num}`;
    };

    for (const team of teamStatsData) {
        let teamFields = [];
        
        team.players.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));

        team.players.forEach(p => {
            const m = p.metrics;
            let statsText = "";

            if (p.role === "TOP") {
                statsText = `GD@15:   ${formatVal(m.gd15, true)}\nDPG:${m.dpg.toFixed(2)}\nDMG Mit: ${formatVal(m.dmgMitigated)}\nKP:${formatVal(m.kp)}%`;
            } else if (p.role === "JGL") {
                statsText = `GD@15:   ${formatVal(m.gd15, true)}\nKP:${formatVal(m.kp)}%\nVSPM:    ${m.vspm.toFixed(2)}\nDPG:${m.dpg.toFixed(2)}`;
            } else if (p.role === "MID") {
                statsText = `GD@15:   ${formatVal(m.gd15, true)}\nDPG:${m.dpg.toFixed(2)}\nKP:      ${formatVal(m.kp)}\%\nVSPM:${m.vspm.toFixed(2)}`;
            } else if (p.role === "BOT") {
                statsText = `GD@15:   ${formatVal(m.gd15, true)}\nDPG:${m.dpg.toFixed(2)}\nKP:      ${formatVal(m.kp)}\%\nCSD@14:${formatVal(m.csd14, true)}`;
            } else if (p.role === "SUP") {
                statsText = `VSPM:    ${m.vspm.toFixed(2)}\nHSP:${formatVal(m.hsp)}\nKP:      ${formatVal(m.kp)}\%\nGD@15:${formatVal(m.gd15, true)}`;
            } else {
                statsText = `GD@15:   ${formatVal(m.gd15, true)}\nDPG:${m.dpg.toFixed(2)}\nKP:      ${formatVal(m.kp)}\%\nVSPM:${m.vspm.toFixed(2)}`;
            }

            teamFields.push({
                name: `[${p.role}]${p.gameName}`,
                value: `*${formatRank(p.rankData)}*\n\`\`\`yaml\n${statsText}\n\`\`\``,
                inline: true
            });
        });

        embeds.push({
            title: `${team.teamDisplay} - Raw Stats (Letzte 10 SoloQ)`,
            color: UIC_COLOR,
            fields: teamFields,
            footer: { text: "Bereitgestellt durch UIC" },
            timestamp: new Date().toISOString()
        });
    }

    embeds.push({
        title: "Legende & Benchmarks (Einordnung der Raw Stats)",
        description: "Ein kurzer Guide, um die eigenen Metriken besser einordnen zu können. \n*Achtung: Werte wie HSP und DMG Mitigated sind extrem Champion-abhängig!*",
        color: 0xFFAA00,
        fields: [
            { name: "GD@15 (Gold) / CSD@14 (CS Diff)", value: "Dein Vorsprung in der Laning-Phase.\n`GD > +300` = Solide (ca. 1 Kill vorn).\n`CSD > +15` = Deutlicher Farm-Lead." },
            { name: "DPG (Damage Per Gold)", value: "Effizienz: Wie viel Schaden machst du mit deinem Gold?\n`~1.0` = Durchschnitt.\n`> 1.3` = Starker Carry (ADC/Mid)." },
            { name: "VSPM (Vision Score per Minute)", value: "Laner: `~1.0`.\nSup/Jgl: `> 2.0` (Top-Tier Supports peilen `> 2.5` an)." },
            { name: "KP (Kill Participation)", value: "Kills + Assists an den Teamkills.\nLaner: `> 50%`. Jungler & Supports: `> 60%`." },
            { name: "HSP (Heal & Shield) / DMG Mit (Absorb)", value: "HSP: Enchanter (Lulu/Soraka) oft `8.000+`. Engage-Sups `< 1.000`.\nDMG Mit: Tanks/Bruiser absorbieren locker `25.000+`." }
        ],
        footer: { text: "Bereitgestellt durch UIC" }
    });

    await updateOrPostMessage(CH_LEADERBOARD, embeds);
    console.log(`   ✅ [Discord] Updated Team Raw Stats Dashboards & Explainer`);
}

// ----------------- TEAM DIRECTORY OVERVIEW -----------------
async function updateTeamOverview(teamOverviewData) {
    if (!CH_OVERVIEW || !Array.isArray(teamOverviewData) || teamOverviewData.length === 0) return;

    const roleMapping = { "TOP": "Toplane", "JGL": "Jungle", "MID": "Midlane", "BOT": "Botlane", "SUP": "Support", "MNG": "Manager", "COH": "Coach" };
    let embeds = [];

    for (const team of teamOverviewData) {
        let nameColumn = "", roleColumn = "", linksColumn = ""; 
        const roster = Array.isArray(team.roster) ? team.roster : [];
        let validSummonersForMulti = [];

        roster.forEach(p => {
            const tag = p.tagLine && p.tagLine !== "undefined" ? p.tagLine : "EUW";
            nameColumn += `${p.gameName}#${tag}${p.isCaptain ? " 👑" : ""}\n`;
            roleColumn += `${roleMapping[p.role] || p.role}${p.rosterStatus === "substitute" ? " *(Sub)*" : ""}\n`; 

            const encodedName = encodeURIComponent(`${p.gameName}-${tag}`);
            linksColumn += `[op.gg](https://www.op.gg/summoners/euw/${encodedName})${p.lolpros ? ` | [lolpros](${p.lolpros})` : ""}\n`;
            validSummonersForMulti.push(encodeURIComponent(`${p.gameName}#${tag}`));
        });

        const multiSearchUrl = `https://www.op.gg/multisearch/euw?summoners=${validSummonersForMulti.join('%2C')}`;

        embeds.push({
            title: team.teamDisplay || "Unbekanntes Team", 
            description: roster.length > 0 ? `🔎 **[Team OP.GG Multi-Search öffnen](${multiSearchUrl})**` : "",
            color: UIC_COLOR,
            fields: [ 
                { name: "Kader", value: nameColumn || "-", inline: true }, 
                { name: "Rolle", value: roleColumn || "-", inline: true },
                { name: "Profile", value: linksColumn || "-", inline: true }
            ],
            footer: { text: "Bereitgestellt durch UIC" },
            timestamp: new Date().toISOString()
        });
    }

    await updateOrPostMessage(CH_OVERVIEW, embeds);
    console.log(`   ✅ [Discord] Updated Team Overview`);
}

module.exports = { updateLpLeaderboard, updateTeamStatsBoard, updateTeamOverview };
