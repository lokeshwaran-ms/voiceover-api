const http = require('http');
const url = require('url');
const dotenv = require('dotenv');
const { errorResponseHeaders, corsHeaders } = require('./headers.js');
const handleVoiceOver = require('./routes/voiceOver.js');
const handleClearCacheByTexts = require('./routes/clearCacheByTexts.js');
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const handleScanScoreSheet = require('./routes/scanScoreSheet.js');
const handleExternalImport = require('./routes/externalImport.js');

dotenv.config();

// Check api key is present
if (!process.env.ELEVENLABS_API_KEY) {
    console.error('ELEVENLABS_API_KEY environment variable is not set.');
    process.exit(1);
}

const elevenlabsClient = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
})

const server = http.createServer((req, res) => {
    try {
        const parsedUrl = url.parse(req.url, true);
        console.log(`[${req.method}] - ${parsedUrl.pathname}`);
        const apiKey = req.headers['x-api-key'];
        
        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(204, corsHeaders);
            return res.end();
        }

        // Health Check
        if (req.method === 'GET' && parsedUrl.pathname === '/api/health-check') {
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ status: 'ok' }));
            return;
        }

        // All request below are protected by apiKey
        if (!apiKey || apiKey !== process.env.ACCESS_API_KEY) {
            res.writeHead(401, errorResponseHeaders);
            res.end(JSON.stringify({
                status: "unauthorized",
                message: "Unauthorized: Invalid or missing API key."
            }));
            return;
        }

        if (req.method === 'POST' && parsedUrl.pathname === '/api/voice-over') {
            // Handle Generate voice over api
            handleVoiceOver(req, res, elevenlabsClient);
        } else if (req.method === 'POST' && parsedUrl.pathname === '/api/voice-over/clear-cache') {
            // Clear Voiceover Cache
            handleClearCacheByTexts(req, res);
        } else if (req.method === 'POST' && parsedUrl.pathname === '/api/games/scan-score-sheet') {
            // Scan Score Card.
            handleScanScoreSheet(req, res);
        }  else if (req.method === 'POST' && parsedUrl.pathname === '/api/games/external-import') {
            // External Games import.
            handleExternalImport(req, res);
        } else {
            res.writeHead(404, errorResponseHeaders);
            res.end('Not Found');
        }
    } catch (err) {
        console.error("[ERROR] Uncaught error in request:", err);
        if (!res.headersSent) {
            res.writeHead(500, errorResponseHeaders);
            res.end(JSON.stringify({ status: "error", message: "Internal Server Error" }));
        }
    }
});

// Global error handlers
process.on("unhandledRejection", err => {
    console.error("Unhandled Rejection:", err);
});
process.on("uncaughtException", err => {
    console.error("Uncaught Exception:", err);
});

// Client side error handling
server.on("clientError",(err, socket) => {
    console.error("Client error:", err);
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
})

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});