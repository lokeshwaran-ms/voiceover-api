const http = require('http');
const url = require('url');
const dotenv = require('dotenv');
const { errorResponseHeaders, corsHeaders } = require('./headers.js');
const handleVoiceOver = require('./routes/voiceOver.js');
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');

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

        // Handle Generate voice over api
        if (req.method === 'POST' && parsedUrl.pathname === '/api/voice-over') {
            handleVoiceOver(req, res, elevenlabsClient);
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