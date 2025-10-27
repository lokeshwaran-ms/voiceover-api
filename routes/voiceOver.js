const archiver = require('archiver');
const { rm } = require('fs/promises');
const { zipResponseHeaders, errorResponseHeaders } = require('../headers');
const path = require('path');
const validateVoiceOver = require('../validators/validateVoiceOver');
const { Mutex } = require('async-mutex');
const VoiceoverManager = require('../lib/voiceoverManager');
const { StringDecoder } = require('string_decoder');

const mutex = new Mutex(1);

function handleVoiceOver(req, res, elevenlabsClient) {
    let body = '';
    const decoder = new StringDecoder('utf8');


    req.on('data', chunk => {
        body += decoder.write(chunk);
    });

    req.on('end', async () => {
        decoder.end();
        const release = await mutex.acquire();
        try {
            // TODO: Code Refactor: move validation logic in separate file and 
            //       remove mutexmanager add those methods in video manager itself
            const parsedBody = JSON.parse(body || '{}');

            // Run the validations
            const validation = validateVoiceOver(parsedBody);
            if (!validation.valid) {
                res.writeHead(400, errorResponseHeaders);
                return res.end(JSON.stringify(validation));
            }

            const { messages, elevenlabs } = parsedBody;
            // All config is from elevenlabs are added to the elevenlabs instance
            let elevenlabsConfig = {
                voiceId: elevenlabs?.voiceId,
                request: elevenlabs?.request,
                requestOptions: elevenlabs?.requestOptions,
            };
            // Create voiceoverManager with requested config.
            const voiceoverManager = new VoiceoverManager(elevenlabsClient, elevenlabsConfig);

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
            const tempOutputPath = await voiceoverManager.getTempOutputPath();

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
            const remainingCredits = await voiceoverManager.getRemainingCredits();
            const creditStatus = `ElevenLabs API Credits remaining: ${remainingCredits}`;
            console.log("[ElevenLabs] - " + creditStatus);
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
            release();
        }
    });
}

module.exports = handleVoiceOver;