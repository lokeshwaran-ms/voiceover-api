const http = require('http');
const url = require('url');
const { StringDecoder } = require('string_decoder');
const archiver = require('archiver');
const { rm } = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const VoiceoverManager = require('./voiceoverManager.js');
const { errorResponseHeaders, corsHeaders, zipResponseHeaders } = require('./headers.js');
const { Mutex } = require('async-mutex');

dotenv.config();

// Check api key is present
if (!process.env.ELEVENLABS_API_KEY) {
    console.error('ELEVENLABS_API_KEY environment variable is not set.');
    process.exit(1);
}

const voiceoverManager = new VoiceoverManager({
    apiKey: process.env.ELEVENLABS_API_KEY,
})
const mutex = new Mutex(1);

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    console.log(`[${req.method}] - ${parsedUrl.pathname}`);
    const apiKey = req.headers['x-api-key'];
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        return res.end();
    }

    // Api Key is required to access the api
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
        let body = '';
        const decoder = new StringDecoder('utf8');
    

        req.on('data', chunk => {
            body += decoder.write(chunk);
        });

        req.on('end', async () => {
            decoder.end();
            try {
                await mutex.acquire();
                // TODO: Code Refactor: move validation logic in separate file and 
                //       remove mutexmanager add those methods in video manager itself
                const parsedBody = JSON.parse(body || '{}');
                const { messages, elevenlabs } = parsedBody;

                if (!Array.isArray(messages) || messages.length === 0) {
                    res.writeHead(400, errorResponseHeaders);
                    return res.end(JSON.stringify({
                        status: "invalid_messages",
                        message: "Invalid input: messages must be a non-empty array."
                    }));
                }

                // Only message within 100 is valid
                if (messages.length >= 100) {
                    res.writeHead(400, errorResponseHeaders);
                    return res.end(JSON.stringify({
                        status: "too_many_messages",
                        message: "Too many messages. Please provide up to 100 messages."
                    }));
                }

                // All config is from elevenlabs are added to the elevenlabs instance
                let elevenlabsConfig = {
                    voiceId: elevenlabs?.voiceId,
                    request: elevenlabs?.request,
                    requestOptions: elevenlabs?.requestOptions,
                };
                // characterLimit is 1000 (10s) and characterCount it usage chars
                const remainingCreditsBeforeGenerate = await voiceoverManager.getRemainingCredits();
                const requestedCredits =  messages.map(msg => msg.text).join('').length;

                // API Limit exceeded Validation
                if (remainingCreditsBeforeGenerate === 0 || remainingCreditsBeforeGenerate < requestedCredits) {
                    res.writeHead(400, errorResponseHeaders);
                    const message = `API Credit Limit reached remaining: ${remainingCreditsBeforeGenerate}, requested: ${requestedCredits}`;
                    console.log("[ElevenLabs] - " + message)
                    return res.end(JSON.stringify({
                        status: "quota_exceeded",
                        message
                    }));
                }

                
                const audioPaths = [];
                const tempOutputPath = voiceoverManager.getTempOutputPath();

                for (let i = 0; i < messages.length; i++) {
                    const message = messages[i];
                    if (message.name === undefined || message.text === undefined) {
                        console.warn(`[ElevenLabs] - Skipping message due to missing 'name' or 'text' property: ${JSON.stringify(message)}`);
                        continue;
                    }
                    const generateFilePath = await voiceoverManager.generate(message, elevenlabsConfig);
                    audioPaths.push(generateFilePath);
                }

                const spriteData = await voiceoverManager.joinSprites(audioPaths, tempOutputPath)

                const zipArchive = archiver('zip', { zlib: { level: 9 } });

                res.writeHead(200, zipResponseHeaders);

                zipArchive.pipe(res);

                zipArchive.file(`${tempOutputPath}.mp3`, { name: 'output.mp3' });
                zipArchive.append(JSON.stringify(spriteData, null, 2), { name: 'output.json' });

                zipArchive.on('end', async () => {
                    console.log('[zipArc] - Zip archive sent successfully.');
                    const tempDir = path.dirname(tempOutputPath);
                    try {
                        await rm(tempDir, { recursive: true, force: true });
                        console.log(`[zipArc] - Deleted temp directory: ${tempDir}`);
                    } catch (err) {
                        console.warn(`[zipArc] - Failed to delete temp directory: ${tempDir}`, err);
                    }
                });
                

                zipArchive.on('error', err => {
                    console.error('Archive error:', err);
                    if (!res.headersSent) {
                        res.writeHead(500, errorResponseHeaders);
                        res.end('Internal Server Error');
                    }
                });

                // Send the zip file in response. 
                zipArchive.finalize(); 
            } catch (err) {
                console.error('Processing error:', err);
                res.writeHead(400, errorResponseHeaders);
                if (err?.body?.detail?.status === "quota_exceeded") {
                    res.end(JSON.stringify({
                        status: "quota_exceeded",
                        message: "Character limit reached."
                    }));
                } else {
                    res.end(JSON.stringify({
                        status: "invalid_request",
                        message: "Invalid Request"
                    }));
                }
            } finally {
                console.log(`[Mutex] - Mutex released.`);
                const remainingCredits = await voiceoverManager.getRemainingCredits();
                const creditStatus = `ElevenLabs API Credits remaining: ${remainingCredits}`;
                console.log("[ElevenLabs] - " + creditStatus);
                mutex.release();
            }
        });
    } else {
        res.writeHead(404, errorResponseHeaders);
        res.end('Not Found');
    }
    
    if (req.method === 'GET' && parsedUrl.pathname === '/api/clear-cache') {
        try {
            res.writeHead(200, corsHeaders);
            res.on("end", async () => {
                await voiceoverManager.clearCache();
            })
            return res.end(JSON.stringify({ status: "success", message: "Cache cleared successfully." }));
        } catch (error) {
            console.error('Error clearing cache:', error);
            res.writeHead(500, errorResponeHeaders);
            return res.end(JSON.stringify({ status: "error", message: "Failed to clear cache." }));
        }
    
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
