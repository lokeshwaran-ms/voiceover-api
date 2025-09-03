const fs = require("fs");
const { pipeline } = require("stream/promises");
const { tmpdir } = require("os");
const { randomUUID } = require("crypto");
const path = require("path");
const audiosprite = require("audiosprite");

class VoiceoverManager {

    constructor(elevenlabsClient, elevenlabsConfig = {}) {
        this.cacheDir = path.join(__dirname, "voiceover-cache");
        this.fileMapPath = path.join(__dirname, "voiceover-cache", "fileMap.json");
        this.cacheFileMap = new Map(); 
        this.elevenlabsClient = elevenlabsClient;
        this.elevenlabsConfig = elevenlabsConfig;
        this.initializeCache();
    }
    
    async initializeCache() {
        try {
            await fs.promises.access(this.cacheDir);
            await fs.promises.access(this.fileMapPath);
            const fileMap = await fs.promises.readFile(this.fileMapPath, 'utf8');
            this.cacheFileMap = new Map(Object.entries(JSON.parse(fileMap)));
        } catch {
            await fs.promises.mkdir(this.cacheDir, { recursive: true });
            await fs.promises.writeFile(this.fileMapPath, JSON.stringify({}, null, 2));
        }
    }

    async getRemainingCredits() {
        const subscription = await this.elevenlabsClient.user.subscription.get();
        return subscription.characterLimit - subscription.characterCount;
    }
    
    async getTempOutputPath() {
        const tempDir = path.join(tmpdir(), `audiosprite-${randomUUID()}`);
        await fs.promises.mkdir(tempDir);
        return path.join(tempDir, 'output');
    }

    async generate(message, elevenlabsConfig, skipCache) {
        const { name, text } = message;
        const cachedFilePath = this.getCachedFilePath(text, elevenlabsConfig.voiceId); // can be a cached file path or new cache path
        // For testing purpose we added this skipCache later we need to remove this
        if (!skipCache && await this.fileExists(cachedFilePath)) {
            console.log(`[ElevenLabs] - Using cached audio for: "${text}"`);
            const tempFilePath = path.join(tmpdir(), `${name}.mp3`)
            await fs.promises.copyFile(cachedFilePath, tempFilePath);
            return tempFilePath;
        }
        // No Existing cache for this message proceed to generate.
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
        await fs.promises.copyFile(cachedFilePath, tempFilePath);
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

    getCacheKey(text, voiceId) {
        // IF the key matches return the key else create new cache key
        const fileKey = `${voiceId}-${text}`
        if (this.cacheFileMap.has(fileKey)) {
            return this.cacheFileMap.get(fileKey);
        }
        this.cacheFileMap.set(fileKey, crypto.randomUUID());
        return this.cacheFileMap.get(fileKey);
    }

    getCachedFilePath(text, voiceId) {
        // If found in cache return the file path else return new cache file path.
        const cacheKey = this.getCacheKey(text, voiceId);
        return path.join(this.cacheDir, `${cacheKey}.mp3`);
    }

    async fileExists(filePath) {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async updateCache(text, voiceId) {
        try {
            const fileMap = await fs.promises.readFile(this.fileMapPath, 'utf8');
            const parsedFileMap = JSON.parse(fileMap);
            parsedFileMap[`${voiceId}-${text}`] = this.getCacheKey(text, voiceId);
            await fs.promises.writeFile(this.fileMapPath, JSON.stringify(parsedFileMap, null, 2));
        } catch (error) {
            console.error('[ERROR] - Error updating cache:', error);
        }
    }
}

module.exports = VoiceoverManager;