async function getAccountByRiotId(gameName, tagLine) {
    // Placeholder: Converts Name#Tag to PUUID
    console.log(`   -> [Riot API] Fetching PUUID for ${gameName}#${tagLine}`);
}

async function getMatchHistory(puuid) {
    // Placeholder: Gets last 5 games
    console.log(`   -> [Riot API] Fetching history for ${puuid}`);
}

module.exports = { getAccountByRiotId, getMatchHistory };
