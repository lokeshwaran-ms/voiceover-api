// move all validators for scanscoresheet to here
function validateScanScoreSheet(data) {
    const { scorecardBase64, userEmail } = data;

    if (!scorecardBase64) {
        return {
            valid: false,
            status: "missing_field",
            message: "Missing scorecardBase64 field"
        };
    }

    if (typeof scorecardBase64 !== 'string') {
        return {
            valid: false,
            status: "invalid_type",
            message: "scorecardBase64 must be a string"
        };
    }

    // Basic check for base64 format (starts with data:image/...)
    if (!scorecardBase64.startsWith('data:image/') && !scorecardBase64.startsWith('/9j/') && !scorecardBase64.startsWith('iVBORw0KGgo')) {
        return {
            valid: false,
            status: "invalid_format",
            message: "scorecardBase64 does not appear to be a valid base64 image string"
        };
    }

    // check for user email
    if (!userEmail) {
        return {
            valid: false,
            status: "invalid_type",
            message: "Missing userEmail field"
        };
    }
    
    return { valid: true };
}

module.exports = validateScanScoreSheet;