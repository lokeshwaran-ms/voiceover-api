const audiosprite = require("audiosprite");
const { randomUUID } = require("crypto");
const fs = require('fs');
const { tmpdir } = require("os");
const path = require("path");
const { pipeline } = require('stream/promises');
const MutexManager = require("./mutexManager");

const whiteListOrigins = [
    "http://localhost:5173",
    "http://191.168.29.52:5173"
]

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const spriteAudio = async (audioPaths = [], outputPath = "output.mp3") => {
    return await new Promise((resolve, reject) => {
        audiosprite(audioPaths, {
            output: outputPath,
            format: 'howler2',
            export: "mp3",
        }, (err, obj) => {
            if (err) reject(err);
            else resolve(obj);
        });
    });
};

const mutexManager = new MutexManager()

const generateVoiceOver = async (elevenlabsClient, elevenlabsConfig, messages) => {
    try {
        const tempDir = path.join(tmpdir(), `audiosprite-${randomUUID()}`);
        fs.mkdirSync(tempDir);
        const outputPath = path.join(tempDir, 'output');
        
        const audioPaths = [];

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (message.name === undefined || message.text === undefined) {
                console.warn(`[ElevenLabs] Skipping message due to missing 'name' or 'text' property: ${JSON.stringify(message)}`);
                continue;
            }
            const name = message.name;
            const text = message.text;  
            
            
            const filePath = mutexManager.getCacheFilePathByText(text);
            // check voiceOversDir contains text if contains return that.
            if (await mutexManager.fileExists(filePath)) {
                console.log(`[ElevenLabs] Using cached audio for: "${text}"`);
                audioPaths.push(filePath);
                continue;
            }

            await mutexManager.execute(text, async () => 
                await textToSpeech(elevenlabsClient, elevenlabsConfig, text, filePath)
            );

            audioPaths.push(filePath);
        }

        return { audioPaths, outputPath };
    } catch (error) {
        console.error('[ElevenLabs] Error generating voice over:', error);
        throw error;
    }
}

const textToSpeech = async (elevenlabsClient, elevenlabsConfig, text, filePath) => {
    try {
        const audioStream = await elevenlabsClient.textToSpeech.stream(
            elevenlabsConfig.voiceId, 
            {
                modelId: 'eleven_multilingual_v2',
                outputFormat: 'mp3_44100_128',
                text,
                voiceSettings: {
                    stability: 0.5,
                    similarity_boost: 0.5,
                },
                ...elevenlabsConfig.request
            }, 
            elevenlabsConfig.requestOptions
        );;
        const writeStream = fs.createWriteStream(filePath);
        await pipeline(audioStream, writeStream);
        console.log(`[ElevenLabs] Generated audio for: "${text}"`);
        return filePath;
    } catch (error) {
        console.error('[ElevenLabs] Error textToSpeech:', error);
        throw error;
    }
}


module.exports = {
    corsHeaders,
    generateVoiceOver,
    spriteAudio,
    whiteListOrigins
}