function validateExternalImport(data) {
    const { platform, username } = data;

    if (!platform || !username) {
        return {
            valid: false,
            status: "missing_field",
            message: "Missing platform or username field"
        };
    }
    
    return { valid: true };
}

module.exports = validateExternalImport;