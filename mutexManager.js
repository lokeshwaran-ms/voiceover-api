const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class MutexManager {
    constructor(cacheDirName = "voiceover-cache") {
        this.cacheDir = path.join(__dirname, cacheDirName);
        this.fileMapPath = path.join(__dirname, cacheDirName, "fileMap.json");
        this.cacheFileMap = new Map(); 
        this.activeTasks = new Map(); // This acts as mutex storage
        this.initializeCache();
    }

    async initializeCache() {
        try {
            await fs.access(this.cacheDir);
            await fs.access(this.fileMapPath);
            const fileMap = await fs.readFile(this.fileMapPath, 'utf8');
            this.cacheFileMap = new Map(Object.entries(JSON.parse(fileMap)));
        } catch {
            await fs.mkdir(this.cacheDir, { recursive: true });
            await fs.writeFile(this.fileMapPath, JSON.stringify({}, null, 2));
        }
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

    getCacheFilePathByText(text, voiceId) {
        // If found in cache return the file path else return new cache file path.
        const cacheKey = this.getCacheKey(text, voiceId);
        return path.join(this.cacheDir, `${cacheKey}.mp3`);
    }

    async fileExists(filePath) {
        try {
            // Check if the file exists even in race conditions, 
            // fileExists() function calls fs.promises.access() and confirms that the file exists.
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async observe(text, generationFn) {

        if (this.activeTasks.has(text)) {
            console.log(`[Mutex] - Waiting for ongoing generation: ${text.substring(0, 50)}...`);
            return await this.activeTasks.get(text);
        }

        // Call the function only when we actually take the lock
        const promise = generationFn();
        this.activeTasks.set(text, promise);

        try {
            const result = await promise;
            return result;
        } finally {
            this.activeTasks.delete(text);
        }
    }

    async updateCache(text, voiceId) {
        try {
            const fileMap = await fs.readFile(this.fileMapPath, 'utf8');
            const parsedFileMap = JSON.parse(fileMap);
            parsedFileMap[`${voiceId}-${text}`] = this.getCacheKey(text, voiceId);
            await fs.writeFile(this.fileMapPath, JSON.stringify(parsedFileMap, null, 2));
        } catch (error) {
            console.error('[Mutex] - Error updating cache:', error);
        }
    }

    async clearCache() {
        try {
            const files = await fs.readdir(this.cacheDir);
            // except fileMap.json delete all
            const filesToDelete = files.filter(file => path.join(this.cacheDir, file) !== this.fileMapPath);
            await Promise.all(
                filesToDelete.map(file => fs.unlink(path.join(this.cacheDir, file)))
            );
            // Recreate an empty fileMap.json
            await fs.writeFile(this.fileMapPath, JSON.stringify({}, null, 2));
            console.log('[Mutex] - Cache cleared');
        } catch (error) {
            console.error('[Mutex] - Error clearing cache:', error);
        }
    }
}

module.exports = MutexManager;