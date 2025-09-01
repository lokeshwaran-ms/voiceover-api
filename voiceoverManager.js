const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const MutexManager = require("./mutexManager");
const fs = require("fs");
const { pipeline } = require("stream/promises");
const { tmpdir } = require("os");
const { randomUUID } = require("crypto");
const path = require("path");
const audiosprite = require("audiosprite");

class VoiceoverManager extends MutexManager {

    constructor(options = {}) {
        if (!options.apiKey) {
            throw new Error("API key is required to initialize VoiceoverManager.");
        }
        super();
        this.initializeVoiceover(options);
    }
    
    initializeVoiceover(options) {
        this.elevenlabsClient = new ElevenLabsClient({
            apiKey: options.apiKey,
        });
        this.elevenlabsConfig = options.elevenlabsConfig;
    }

    async getRemainingCredits() {
        const subscription = await this.elevenlabsClient.user.subscription.get();
        return subscription.characterLimit - subscription.characterCount;
    }
    
    getTempOutputPath() {
        const tempDir = path.join(tmpdir(), `audiosprite-${randomUUID()}`);
        fs.mkdirSync(tempDir);
        return path.join(tempDir, 'output');
    }

    async generate(message, elevenlabsConfig) {
        const { name, text } = message;
        const cachedFilePath = this.getCacheFilePathByText(text, elevenlabsConfig.voiceId); // can be a cached file path or new cache path
        if (await this.fileExists(cachedFilePath)) {
            console.log(`[ElevenLabs] - Using cached audio for: "${text}"`);
            const tempFilePath = path.join(tmpdir(), `${name}.mp3`)
            fs.copyFileSync(cachedFilePath, tempFilePath);
            return tempFilePath;
        }
        const audioStream = await this.elevenlabsClient.textToSpeech.stream(
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
        );
        const writeStream = fs.createWriteStream(cachedFilePath);
        await pipeline(audioStream, writeStream);
        console.log(`[ElevenLabs] - Generated audio for: "${text}"`);
        await this.updateCache(text, elevenlabsConfig.voiceId);

        const tempFilePath = path.join(tmpdir(), `${name}.mp3`)
        fs.copyFileSync(cachedFilePath, tempFilePath);
        return tempFilePath;
    }

    async joinSprites(audioFiles, outputPath) {
        // sprite the audio files provided
        return new Promise((resolve, reject) => {
            audiosprite(audioFiles, {
                output: outputPath,
                format: 'howler2',
                export: "mp3",
            }, (err, obj) => {
                if (err) reject(err);
                else resolve(obj);
            });
        });
    }

}

module.exports = VoiceoverManager;