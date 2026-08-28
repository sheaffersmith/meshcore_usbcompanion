export function buildBotResponse(message) {
    /*
     * message contains the enriched data from index.js:
     *
     * {
     *   receivedAt,
     *   sentAt,
     *   channelIdx,
     *   channel,
     *   sender,
     *   text,
     *   rawText,
     *   snr,
     *   routing,
     *   hopCount,
     *   pathHashSize,
     *   pathLenRaw,
     *   txtType,
     *   senderTimestamp,
     *   dedupeId,
     *   raw
     * }
     */

    if (!message.sender) {
        return null;
    }

    const text = message.text
        .trim()
        .toLowerCase();


    if (/\btest(?:ing)?\b/i.test(message.text)) {
        const hopText =
            message.hopCount === null
                ? 'direct'
                : `${message.hopCount} hop${message.hopCount === 1 ? '' : 's'}`;

        return `@[${message.sender}] Heard you. ${hopText} to Arden, NC, SNR ${message.snr} dB. I respond to "test" or "testing" in your messages`;
    }


    return null;
}