function validateVoiceOver(body) {
    const { messages } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
        return {
            valid: false,
            status: "invalid_messages",
            message: "Invalid input: messages must be a non-empty array."
        };
    }

    // Only message within 100 is valid
    if (messages.length >= 100) {
        return {
            valid: false,
            status: "too_many_messages",
            message: "Too many messages. Please provide up to 100 messages."
        };
    }

    return { valid: true }
}

module.exports = validateVoiceOver;