import { getCleanJoke } from './jokeService.js';
const botName =
    (process.env.BOT_NAME ?? 'Pinehurst-MeshBot')
        .trim()
        .toLowerCase();

export function isBotTagged(message) {
    if (!message?.text) {
        return false;
    }

    const text =
        message.text
            .trim()
            .toLowerCase();

    return (
        text.includes(`@[${botName}]`) ||
        text.includes(botName)
    );
}

export async function buildBotResponse(message) {
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

    if (!message.sender || !message.text) {
        return null;
    }

    const text =
        message.text
            .trim()
            .toLowerCase();

    /*
     * Was Pinehurst-MeshBot mentioned?
     *
     * Supports:
     * @[Pinehurst-MeshBot]
     * Pinehurst-MeshBot
     */
    const botWasTagged =
        isBotTagged(message);

  if (
        botWasTagged &&
        /\bjoke\b/.test(text)
    ) {
        const prefix =
            `@[${message.sender}] `;

        /*
         * MeshCore channel payload:
         *
         * 160 - bot advert name length - 2
         *
         * Leave a few extra bytes of safety margin.
         */
        const botAdvertName =
            process.env.BOT_NAME;

        const meshCoreLimit =
            160 -
            Buffer.byteLength(
                botAdvertName,
                'utf8'
            ) -
            2;

        const prefixBytes =
            Buffer.byteLength(
                prefix,
                'utf8'
            );

        const safetyMargin = 5;

        const availableJokeBytes =
            meshCoreLimit -
            prefixBytes -
            safetyMargin;

        try {
            const joke =
                await getCleanJoke(
                    availableJokeBytes
                );

            return `${prefix}${joke}`;

        } catch (error) {
            console.error(
                'Joke API error:',
                error
            );

            return `${prefix}Sorry, I couldn't find a short joke right now.`;
        }
    }

    /*
     * TEST / TESTING
     */
    if (/\btest(?:ing)?\b/.test(text)) {
        const hopText =
            message.hopCount === null
                ? 'direct'
                : `${message.hopCount} hop${message.hopCount === 1 ? '' : 's'}`;

        return `@[${message.sender}] Heard you. ${hopText} to Arden, NC, SNR ${message.snr} dB. I respond to "test" in your messages or tag me and ask for a "joke". `;
    }

    return null;
}