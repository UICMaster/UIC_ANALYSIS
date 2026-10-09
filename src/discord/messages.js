/**
 * src/discord/messages.js
 * Formats and delivers leaderboards and Option A split monospace dashboards to Discord.
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
    if (!BOT_TOKEN || retries <= 0) return null;

    const options = { method, headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        if (response.status === 429) {
            const errorData = await response.json();
            await new Promise(res => setTimeout(res, (errorData.retry_after * 1000) + 100));
            return discordFetch(endpoint, method, body, retries - 1);
        }
        if (!response.ok) {
            console.error(`❌ [Discord API] ${response.status} Error on ${endpoint}:`, await response.text());
            return null;
        }
        
        const text = await response.text();
        return text ? JSON.parse(text) : true;
    } catch (error) {
        console.error(`❌ [Discord Fetch Exception]:`, error.message);
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
        await new Promise(r => setTimeout(r, 600)); 
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

// ----------------- OPTION A: SPLIT MONOSPACE DASHBOARD -----------------
async function updateTeamStatsBoard(teamStatsData) {
    if (!CH_LEADERBOARD || teamStatsData.length === 0) return;
    
    let embeds = [];
    const roleOrder = ["TOP", "JGL", "MID", "BOT", "SUP"];
    const sep = "|"; // Variable separation prevents formatting breakdown

    const pad = (str, len, alignLeft = true) => {
        const s = String(str ?? "");
        return alignLeft ? s.padEnd(len, ' ').slice(0, len) : s.padStart(len, ' ').slice(-len);
    };

    const fmtDelta = (val, len) => {
        const num = Math.round(val || 0);
        const signed = num > 0 ? `+${num}` : `${num}`;
        return pad(signed, len, false);
    };

    for (const team of teamStatsData) {
        team.players.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));

        // Chunking the roster to prevent Discord rejecting embeds > 1024 chars
        const chunkSize = 8;
        for (let i = 0; i < team.players.length; i += chunkSize) {
            const playerChunk = team.players.slice(i, i + chunkSize);

            let t1 = `ROL ${sep} SPIELER    ${sep} GD@15 ${sep} CSD14 ${sep} CS/M ${sep} VSPM\n`;
            t1 +=   `----+------------+-------+-------+------+-----\n`;

            let t2 = `ROL ${sep} SPIELER    ${sep}  KDA  ${sep}  KP%  ${sep} DPM  ${sep} DPG \n`;
            t2 +=   `----+------------+-------+-------+------+-----\n`;

            playerChunk.forEach(p => {
                const m = p.metrics || {};
                const role = pad(p.role, 3, true);
                const name = pad(p.gameName, 10, true);

                // Table 1: Early Game & Macro
                const gd15  = fmtDelta(m.gd15, 5);
                const csd14 = fmtDelta(m.csd14, 5);
                const csm   = pad((m.csm || 0).toFixed(1), 4, false);
                const vspm  = pad((m.vspm || 0).toFixed(2), 4, false);
                t1 += `${role} ${sep} ${name} ${sep} ${gd15} ${sep} ${csd14} ${sep} ${csm} ${sep} ${vspm}\n`;

                // Table 2: Teamfight & Efficiency
                const kda = pad((m.kda || 0).toFixed(2), 5, false);
                const kp  = pad(`${Math.round(m.kp || 0)}%`, 5, false);
                const dpm = pad(Math.round(m.dpm || 0), 4, false);
                const dpg = pad((m.dpg || 0).toFixed(2), 4, false);
                t2 += `${role} ${sep} ${name} ${sep} ${kda} ${sep} ${kp} ${sep} ${dpm} ${sep} ${dpg}\n`;
            });

            const titleSuffix = team.players.length > chunkSize ? ` (Teil ${Math.floor(i/chunkSize) + 1})` : "";

            embeds.push({
                title: `${team.teamDisplay} - Performance (Letzte 10 SoloQ)${titleSuffix}`,
                color: UIC_COLOR,
                fields: [
                    {
                        name: "Early Game & Macro (GD@15, CSD@14, CS/M, Vision)",
                        value: "```text\n" + t1 + "```",
                        inline: false
                    },
                    {
                        name: "Teamfight & Combat (KDA, Kill Part., DPM, DPG)",
                        value: "```text\n" + t2 + "```",
                        inline: false
                    }
                ],
                footer: { text: "Bereitgestellt durch UIC" },
                timestamp: new Date().toISOString()
            });
        }
    }

    // Benchmark & Legend Embed
    embeds.push({
        title: "Legende & Benchmarks (Einordnung aller 8 Metriken)",
        description: "Richtwerte basierend auf High-Elo SoloQ Durchschnitten:",
        color: 0xFFAA00,
        fields: [
            { 
                name: "Early Game (Laning)", 
                value: "• **GD@15**: `> +300` solider Vorsprung, `< -300` Defizit.\n• **CSD@14**: `> +10` deutlicher Farm-Lead.\n• **CS/M**: Carries peilen `> 8.0` an, Jungler `~6.5-7.0`.\n• **VSPM**: Laner `~1.0`, Support & Jungle `> 2.0`." 
            },
            { 
                name: "Combat & Efficiency", 
                value: "• **KDA**: `> 3.0` solides Positioning & Playmaking.\n• **KP%**: Laner `> 50%`, Roamer/Jgl/Sup `> 60%`.\n• **DPM**: Carries peilen `> 600` an.\n• **DPG**: `> 1.30` hohe Kampfeffizienz pro Gold." 
            }
        ],
        footer: { text: "Bereitgestellt durch UIC" }
    });

    await updateOrPostMessage(CH_LEADERBOARD, embeds);
    console.log(`   ✅ [Discord] Updated Monospace Team Stats Boards`);
}

// ----------------- TEAM DIRECTORY OVERVIEW -----------------
async function updateTeamOverview(teamOverviewData) {
    if (!CH_OVERVIEW || !Array.isArray(teamOverviewData) || teamOverviewData.length === 0) return;

    const roleMapping = { "TOP": "Toplane", "JGL": "Jungle", "MID": "Midlane", "BOT": "Botlane", "SUP": "Support", "MNG": "Manager", "COH": "Coach" };
    let embeds = [];

    for (const team of teamOverviewData) {
        const roster = Array.isArray(team.roster) ? team.roster : [];
        
        // Chunking the roster to prevent 1024 char limits on linksColumn
        const chunkSize = 10;
        
        for (let i = 0; i < roster.length; i += chunkSize) {
            const chunk = roster.slice(i, i + chunkSize);
            let nameColumn = "", roleColumn = "", linksColumn = ""; 
            let validSummonersForMulti = [];

            chunk.forEach(p => {
                const tag = p.tagLine && p.tagLine !== "undefined" ? p.tagLine : "EUW";
                nameColumn += `${p.gameName}#${tag}${p.isCaptain ? " 👑" : ""}\n`;
                roleColumn += `${roleMapping[p.role] || p.role}${p.rosterStatus === "substitute" ? " *(Sub)*" : ""}\n`;

                const encodedName = encodeURIComponent(`${p.gameName}-${tag}`);
                linksColumn += `[op.gg](https://www.op.gg/summoners/euw/${encodedName})${p.lolpros ? ` | [lolpros](${p.lolpros})` : ""}\n`;
                validSummonersForMulti.push(encodeURIComponent(`${p.gameName}#${tag}`));
            });

            const multiSearchUrl = `https://www.op.gg/multisearch/euw?summoners=${validSummonersForMulti.join('%2C')}`;
            const titleSuffix = roster.length > chunkSize ? ` (Teil ${Math.floor(i/chunkSize) + 1})` : "";

            embeds.push({
                title: (team.teamDisplay || "Unbekanntes Team") + titleSuffix, 
                description: chunk.length > 0 ? `🔎 **[Team OP.GG Multi-Search öffnen](${multiSearchUrl})**` : "",
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
    }

    await updateOrPostMessage(CH_OVERVIEW, embeds);
    console.log(`   ✅ [Discord] Updated Team Overview`);
}

module.exports = { updateLpLeaderboard, updateTeamStatsBoard, updateTeamOverview };
