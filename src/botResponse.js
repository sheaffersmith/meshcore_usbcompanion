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


  const wantsJoke =
    /#joke\b/.test(text);

if (wantsJoke) {
    try {
        const prefix =
            `@[${message.sender}] `;

        const botAdvertName =
            process.env.BOT_NAME ??
            'Pinehurst-MeshBot';

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

        return `@[${message.sender}] Sorry, I couldn't find a short joke right now.`;
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

        return `@[${message.sender}] ${hopText} to Arden, NC. Cmds: #joke, test`;
    }

    return null;
}