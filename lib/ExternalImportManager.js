const externalPlatformsConfig = require("./externalPlatformsConfig");

class ExternalImportManager {
    constructor(platform, username) {
        this.platform = platform;
        this.username = username;
        this.externalPlatformsConfig = externalPlatformsConfig.find(source => source.key === platform);
        if (!this.externalPlatformsConfig) {
            throw new Error(`Unsupported platform: ${platform}`);
        }
    }
    
    getPlatformConfig() {
        return this.externalPlatformsConfig;
    }

    async getLast30DaysGames() {
        const config = this.getPlatformConfig();
        if (config.key === "chess.com") {
            return this.getLast30DaysGamesFromChessDotCom();
        } else if (config.key === "lichess.org") {
            return this.getLast30DaysGamesFromLichessOrg();
        }
        return null;
    }

    async getLast30DaysGamesFromChessDotCom() {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 30);

            const endYear = endDate.getFullYear();
            const endMonth = endDate.getMonth() + 1; // getMonth() is 0-indexed
            
            const startYear = startDate.getFullYear();
            const startMonth = startDate.getMonth() + 1;
            
            let fetchPromises = [];
            const config = this.getPlatformConfig();
            // Fetch the current month's games.
            const currentMonthUrl = config.getGamesUrl(this.username, endYear, String(endMonth).padStart(2, '0'));
            fetchPromises.push(fetch(currentMonthUrl).then(res => res.json()));

            // Fetch the previous month's games if the 30-day window crosses a month boundary.
            if (startYear !== endYear || startMonth !== endMonth) {
                const prevMonthUrl = config.getGamesUrl(this.username, startYear, String(startMonth).padStart(2, '0'));
                fetchPromises.push(fetch(prevMonthUrl).then(res => res.json()));
            }

            const results = await Promise.all(fetchPromises);
            const allGames = results.flatMap(data => data.games || []);

            const thirtyDaysAgoTimestamp = startDate.getTime() / 1000;
            
            const recentGames = allGames.filter(game => {
                return game.end_time >= thirtyDaysAgoTimestamp;
            });

            console.log(`Found ${recentGames.length} games in the last 30 days for user '${this.username}'.`);
            return recentGames.map((game) => game.pgn).join("\n\n");
        } catch (error) {
            console.error("An error occurred:", error);
            return null;
        }
    }

    async getLast30DaysGamesFromLichessOrg() {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - 30);
            const config = this.getPlatformConfig();
            const url = config.getGamesUrl(this.username, startDate.getTime(), endDate.getTime());

            const response = await fetch(url, {
                headers: {
                    Accept: "application/x-chess-pgn",
                },
            });

            if (!response.ok) {
                remoteLog(`Lichess API returned status ${response.status}`);
            }

            const pgnText = await response.text();
            return pgnText;

        } catch (error) {
            console.error("An error occurred while fetching Lichess games:", error);
            return null;
        }
    }

    async userExists() {
        try {
            const config = this.getPlatformConfig();
            const url = config?.getUserUrl(this.username);
            if (!url) return false;
            const response = await fetch(url);
            return response.ok;
        } catch (error) {
            console.error("An error occurred while checking user existence:", error);
            return false;
        }
    }

}

module.exports = ExternalImportManager;