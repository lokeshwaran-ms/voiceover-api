const { StringDecoder } = require('string_decoder');
const VoiceoverManager = require('../lib/voiceoverManager');
const { corsHeaders, errorResponseHeaders } = require('../headers');

function handleClearCacheByTexts(req, res) {
    let body = '';
    const decoder = new StringDecoder('utf8');

    req.on('data', chunk => {
        body += decoder.write(chunk);
    });

    req.on('end', async () => {
        decoder.end();
        try {
            const parsedBody = JSON.parse(body || '{}');
            const { texts, voiceId } = parsedBody;


            if (!Array.isArray(texts) || texts.length === 0 || !voiceId) {
                res.writeHead(400, errorResponseHeaders);
                return res.end(JSON.stringify({
                    status: "invalid_input",
                    message: "Invalid input: 'texts' must be a non-empty array and 'voiceId' is required."
                }));
            }
            const voiceoverManager = new VoiceoverManager();
            const clearCacheByTexts =  await voiceoverManager.clearCacheByTexts(texts, voiceId);
            if (clearCacheByTexts.length != texts.length) {
                const invalidTexts = texts.filter(text => !clearCacheByTexts.includes(text));
                console.error(`[Cache] invalid texts (${invalidTexts.length}):`, invalidTexts.toString());
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ 
                    status: "partial", 
                    message: "Some of text are not cleared.", 
                    invalidTexts: invalidTexts,
                }));
            } else {
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ status: "success", message: "Cache cleared for specified texts." }));
            }
        } catch (error) {
            console.error('Error clearing cache by text:', error);
            res.writeHead(500, errorResponseHeaders);
            res.end(JSON.stringify({ status: "error", message: "Failed to clear cache for specified texts." }));
        }
    });
} 

module.exports = handleClearCacheByTexts