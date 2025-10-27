const externalPlatformsConfig = [
    {
        name: "Chess.com",
        key: "chess.com",
        url: "https://www.chess.com/",
        getUserUrl: (username) => `https://api.chess.com/pub/player/${username}`,
        getGamesUrl: (username, year, month) =>
            `https://api.chess.com/pub/player/${username}/games/${year}/${String(month).padStart(2, '0')}`,
        parseGames: (data) => data.games || [],
    },
    {
        name: "Lichess.org",
        key: "lichess.org",
        url: "https://lichess.org/",
        getUserUrl: (username) => `https://lichess.org/api/user/${username}`,
        getGamesUrl: (username, start, end) =>
            `https://lichess.org/api/games/user/${username}?since=${start}&until=${end}&clocks=true`,
        parseGames: (data) => data,
    },
]

module.exports = externalPlatformsConfig;
