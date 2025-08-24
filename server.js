import { createServer } from 'http';
import { parse } from 'url';
import { StringDecoder } from 'string_decoder';
import archiver from 'archiver';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { corsHeaders, generateVoiceOver, spriteAudio } from './utils.js';
import { rm } from 'fs/promises';
import path from 'path';

const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    const errorResponeHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
    console.log(`[${req.method}] ${parsedUrl.pathname}`);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        return res.end();
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
                const parsedBody = JSON.parse(body || '{}');
                const { messages, elevenlabs, audiosprite  } = parsedBody;

                if (!elevenlabs || !elevenlabs.apiKey) {
                    res.writeHead(400, errorResponeHeaders);
                    return res.end(JSON.stringify({                    
                        status: "api_key_missing",
                        message: "ElevenLabs API key is missing."
                    }));
                }
                
                if (!Array.isArray(messages) || messages.length === 0) {
                    res.writeHead(400, errorResponeHeaders);
                    return res.end(JSON.stringify({
                        status: "invalid_messages",
                        message: "Invalid input: messages must be a non-empty array."
                    }));
                }

                // Only message within 100 is valid
                if (messages.length >= 100) {
                    res.writeHead(400, errorResponeHeaders);
                    return res.end(JSON.stringify({
                        status: "too_many_messages",
                        message: "Too many messages. Please provide up to 100 messages."
                    }));
                }

                // All config is from elevenlabs are added to the elevenlabs instance
                let elevenlabsApiKey = elevenlabs.apiKey;
                let elevenlabsConfig = {
                    voiceId: elevenlabs?.voiceId,
                    request: elevenlabs?.request,
                    requestOptions: elevenlabs?.requestOptions,
                };
                const elevenlabsClient = new ElevenLabsClient({
                    apiKey: elevenlabsApiKey,
                });
                const subscription = await elevenlabsClient.user.subscription.get();
                // characterLimit is 1000 (10s) and characterCount it usage chars
                const remainingCredits = subscription.characterLimit - subscription.characterCount;
                const requestedCredits =  messages.map(msg => msg.text).join('').replace(/\s+/g, "").length;

                // API Limit exceeded Validation
                if (remainingCredits === 0 || remainingCredits < requestedCredits) {
                    res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
                    const message = `API Credit Limit reached remaining: ${remainingCredits} requested: ${requestedCredits}`;
                    console.log("[ElevenLabs] - " + message)
                    return res.end(JSON.stringify({
                        status: "quota_exceeded",
                        message
                    }));
                }

                const creditStatus = `ElevenLabs API Credits remaining: ${remainingCredits} requested: ${requestedCredits}`;
                console.log("[ElevenLabs] - " + creditStatus);

                const { audioPaths, outputPath } = 
                    await generateVoiceOver(elevenlabsClient, elevenlabsConfig, messages);

                const spriteData = await spriteAudio(audioPaths, outputPath)

                const zipArchive = archiver('zip', { zlib: { level: 9 } });

                res.writeHead(200, {
                    ...corsHeaders,
                    'Content-Type': 'application/zip',
                    'Content-Disposition': 'attachment; filename="audio-sprites.zip"',
                });

                zipArchive.pipe(res);

                zipArchive.file(`${outputPath}.mp3`, { name: 'output.mp3' });
                zipArchive.append(JSON.stringify(spriteData, null, 2), { name: 'output.json' });

                zipArchive.finalize();

                zipArchive.on('end', async () => {
                    console.log('[zipArc] Zip archive sent successfully.');
                    const tempDir = path.dirname(outputPath);
                    try {
                        await rm(tempDir, { recursive: true, force: true });
                        console.log(`[zipArc] Deleted temp directory: ${tempDir}`);
                    } catch (err) {
                        console.warn(`[zipArc] Failed to delete temp directory: ${tempDir}`, err);
                    }
                });
                

                zipArchive.on('error', err => {
                    console.error('Archive error:', err);
                    if (!res.headersSent) {
                        res.writeHead(500, errorResponeHeaders);
                        res.end('Internal Server Error');
                    }
                });
            } catch (err) {
                console.error('Processing error:', err);
                res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
                if (err.body.detail.status == "quota_exceeded") {
                    console.log(`[${err.body.detail.status}]`, "ERROR****")
                    res.end(JSON.stringify({
                        status: "quota_exceeded",
                        message: "Character limit reached."
                    }))
                } else {
                    res.end("Invalid Request");
                }
            }
        });
    } else {
        res.writeHead(404, errorResponeHeaders);
        res.end('Not Found');
    }
    
    // Call This api to view the request body stucture of the voice-over api
    if (req.method === 'GET' && parsedUrl.pathname === '/api/structure') {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            messages: [
                {
                    name: "audio_file_name_1",
                    text: "This is the first text to be converted to speech."
                },
                {
                    name: "audio_file_name_2",
                    text: "This is the second text."
                }
            ],
            elevenlabs: {
                apiKey: "YOUR_ELEVENLABS_API_KEY",
                voiceId: "YOUR_VOICE_ID",
                // Optional: Adjust voice settings
                request: {
                    stability: 0.5,
                    similarity_boost: 0.5
                },
                // Optional: Add request options
                requestOptions: {
                    // e.g., responseType: 'stream'
                }
            }
        }));
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
