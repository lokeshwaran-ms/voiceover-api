const corsHeaders = {
    'access-control-allow-origin': '*',
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
}

const errorResponseHeaders = corsHeaders;

const zipResponseHeaders = {
    ...corsHeaders,
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="audio-sprites.zip"',
}

module.exports = {
    corsHeaders,
    errorResponseHeaders,
    zipResponseHeaders 
};