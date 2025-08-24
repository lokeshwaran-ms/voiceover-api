import audiosprite from "audiosprite";
import fs from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { join } from "path";
import { pipeline } from 'stream/promises';

export const whiteListOrigins = [
    "http://localhost:5173",
    "http://191.168.29.52:5173"
]

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export const spriteAudio = async (audioPaths = [], outputPath = "output.mp3") => {
    return await new Promise((resolve, reject) => {
        audiosprite(audioPaths, {
            output: outputPath,
            format: 'howler2',
        }, (err, obj) => {
            if (err) reject(err);
            else resolve(obj);
        });
    });
};

export const generateVoiceOver = async (elevenlabsClient, elevenlabsConfig, messages) => {
    try {
        const tempDir = join(tmpdir(), `audiosprite-${randomUUID()}`);
        fs.mkdirSync(tempDir);
        const outputPath = join(tempDir, 'output');
        
        const audioPaths = [];

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (message.name === undefined || message.text === undefined) {
                console.warn(`[ElevenLabs] Skipping message due to missing 'name' or 'text' property: ${JSON.stringify(message)}`);
                continue;
            }
            const name = message.name;
            const text = message.text;  
            const filePath = join(tempDir, `${name}.mp3`);
            console.log(`[ElevenLabs] Generating audio for: "${text}", name: "${name}"`);

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
            
            audioPaths.push(filePath);
        }

        return { audioPaths, outputPath };
    } catch (error) {
        console.error('[ElevenLabs] Error generating voice over:', error);
        throw error;
    }
}