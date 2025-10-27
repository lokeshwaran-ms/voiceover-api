const { corsHeaders, errorResponseHeaders } = require("../headers");
const ExternalImportManager = require("../lib/ExternalImportManager");
const { Mutex } = require('async-mutex');
const { StringDecoder } = require('string_decoder');

const mutex = new Mutex(1);

function handleExternalImport(req, res) {
    let body = '';
    const decoder = new StringDecoder('utf8');


    req.on('data', chunk => {
        body += decoder.write(chunk);
    });

    req.on('end', async () => {
        decoder.end();
        const release = await mutex.acquire();
        try {
            const parsedBody = JSON.parse(body || '{}');

            // Run the validations
            const validation = validateExternalImport(parsedBody);
            if (!validation.valid) {
                res.writeHead(400, errorResponseHeaders);
                return res.end(JSON.stringify(validation));
            }

            const { platform, username } = parsedBody;
            const externalImportManager = new ExternalImportManager(platform, username);
            const userExists = await externalImportManager.userExists();
            if (!userExists) {
                res.writeHead(400, errorResponseHeaders);
                return res.end(JSON.stringify({
                    status: "user_not_found",
                    message: `Username '${username}' not found in '${platform}'`
                }));
            }
            const pgnText = await externalImportManager.getLast30DaysGames();
            if (!pgnText) {
                res.writeHead(400, errorResponseHeaders);
                return res.end(JSON.stringify({
                    status: "no_games_found",
                    message: "No games found in the last 30 days"
                }));
            }

            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ pgn: pgnText }));
            return;
        } catch (err) {
            console.log("[ERROR] Uncaught error in request:", err);
            res.writeHead(400, errorResponseHeaders);
            res.end(JSON.stringify({
                status: "invalid_request",
                message: "Invalid Request try again later."
            }));
        } finally {
            console.log(`[Mutex] - Mutex released.`);
            release();
        }
    });
}

module.exports = handleExternalImport;