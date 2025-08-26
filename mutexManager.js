const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class MutexManager {
    constructor(cacheDirName = "voiceover-cache") {
        this.cacheDir = path.join(__dirname, cacheDirName);
        this.fileMapPath = path.join(__dirname, cacheDirName, "fileMap.json");
        this.activeTasks = new Map(); // This acts as mutex storage
        this.initializeCache();
    }

    async initializeCache() {
        try {
            await fs.access(this.cacheDir);
        } catch {
            await fs.mkdir(this.cacheDir, { recursive: true });
        }
    }
    
    generateCacheKey(text) {
        return crypto.createHash('sha256').update(text).digest('hex');
    }

    getCacheFilePathByText(text) {
        const cacheKey = this.generateCacheKey(text);
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

    async execute(text, generationFn) {
        const cacheKey = this.generateCacheKey(text);

        if (this.activeTasks.has(cacheKey)) {
            console.log(`[Mutex] Waiting for ongoing generation: ${text.substring(0, 50)}...`);
            return await this.activeTasks.get(cacheKey);
        }

        // Call the function only when we actually take the lock
        const promise = generationFn();
        this.activeTasks.set(cacheKey, promise);

        try {
            const result = await promise;
            const fileMap = JSON.parse(await fs.readFile(this.fileMapPath, 'utf8').catch(() => '{}'));
            fileMap[text] = result;
            await fs.writeFile(this.fileMapPath, JSON.stringify(fileMap, null, 2));
            console.log(`[Mutex] Audio cached: ${path.basename(result)}`);
            return result;
        } finally {
            this.activeTasks.delete(cacheKey);
        }
    }


    async clearCache() {
        try {
            const files = await fs.readdir(this.cacheDir);
            await Promise.all(
                files.map(file => fs.unlink(path.join(this.cacheDir, file)))
            );
            console.log('[Mutex] Cache cleared');
        } catch (error) {
            console.error('[Mutex] Error clearing cache:', error);
        }
    }
}

module.exports = MutexManager;