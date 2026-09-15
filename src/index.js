import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildBotResponse, isBotTagged} from './botResponse.js';

import Constants from '../node_modules/@liamcottle/meshcore.js/src/constants.js';
import NodeJSSerialConnection
    from '../node_modules/@liamcottle/meshcore.js/src/connection/nodejs_serial_connection.js';

const port =
    process.env.MESHCORE_PORT ??
    '/dev/ttyACM1';

const logDir =
    process.env.LOG_DIR ??
    './logs';

const botSendEnabled =
    String(process.env.BOT_SEND_ENABLED).toLowerCase() === 'true';

const botTrigger =
    (process.env.BOT_TRIGGER ?? 'test').trim().toLowerCase();

const botMaxMessageAge =
    Number(process.env.BOT_MAX_MESSAGE_AGE ?? 120);

fs.mkdirSync(logDir, { recursive: true });

const connection = new NodeJSSerialConnection(port);

let channels = [];

// Used to prevent responding twice to duplicate packets.
const recentlyProcessed = new Map();

function logTaggedMessage(data) {
    appendJsonLog(
        'tagged.log',
        data
    );
}

function bytesToHex(bytes) {
    return Array.from(bytes ?? [])
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

function logAdvert(advert) {
    const record = {
        receivedAt: new Date().toISOString(),

        name: advert.advName ?? null,

        publicKey: bytesToHex(advert.publicKey),

        type: advert.type,
        flags: advert.flags,

        outPathLen: advert.outPathLen,
        outPath: bytesToHex(
            advert.outPath?.slice(
                0,
                Math.max(0, advert.outPathLen ?? 0)
            )
        ),

        lastAdvert: advert.lastAdvert,
        lastMod: advert.lastMod,

        latRaw: advert.advLat,
        lonRaw: advert.advLon,

        raw: advert
    };

    console.log('\nNew advert:');
    console.dir(record, { depth: null });

    appendJsonLog(
        'adverts.log',
        record
    );
}

function safeFilename(value) {
    return String(value)
        .replace(/^#/, '')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .toLowerCase();
}

function parseChannelText(rawText) {
    const separator = rawText.indexOf(':');

    if (separator === -1) {
        return {
            sender: null,
            text: rawText.trim()
        };
    }

    return {
        sender: rawText.slice(0, separator).trim(),
        text: rawText.slice(separator + 1).trim()
    };
}

function decodePathLen(pathLen) {
    if (pathLen === 0xff) {
        return {
            routing: 'direct',
            hopCount: null,
            hashSize: null
        };
    }

    const hopCount = pathLen & 0x3f;
    const hashSizeCode = (pathLen >> 6) & 0x03;

    const hashSize =
        hashSizeCode === 0 ? 1 :
        hashSizeCode === 1 ? 2 :
        hashSizeCode === 2 ? 3 :
        null;

    return {
        routing: 'flood',
        hopCount,
        hashSize
    };
}

function getChannelName(channelIdx) {
    const channel = channels.find(
        channel => channel.channelIdx === channelIdx
    );

    return channel?.name ?? `channel-${channelIdx}`;
}

function createDedupeId(message) {
    return crypto
        .createHash('sha256')
        .update(
            [
                message.channelIdx,
                message.senderTimestamp,
                message.text
            ].join('|')
        )
        .digest('hex')
        .slice(0, 16);
}

function appendJsonLog(filename, data) {
    const filepath =
        path.join(logDir, filename);

    fs.appendFileSync(
        filepath,
        formatLogJson(data) + '\n\n'
    );
}

function logChannelMessage(channelName, data) {
    appendJsonLog(
        `${safeFilename(channelName)}.log`,
        data
    );
}


function logBotDecision(data) {
    appendJsonLog(
        'bot-responses.log',
        data
    );
}

function normalizeRawForLog(raw) {
    if (!raw || typeof raw !== 'object') {
        return raw;
    }

    const normalized = {
        ...raw
    };

    if (normalized.publicKey) {
        normalized.publicKey =
            bytesToHex(normalized.publicKey);
    }

    if (normalized.outPath) {
        normalized.outPath =
            bytesToHex(normalized.outPath);
    }

    return normalized;
}

function contactToLogRecord(contact) {
    return {
        capturedAt: new Date().toISOString(),

        name: contact.advName ?? null,

        publicKey: bytesToHex(contact.publicKey),

        type: contact.type,
        flags: contact.flags,

        outPathLen: contact.outPathLen,

        outPath: bytesToHex(
            contact.outPath?.slice(
                0,
                Math.max(0, contact.outPathLen ?? 0)
            )
        ),

        lastAdvert: contact.lastAdvert,
        lastMod: contact.lastMod,

        lat:
            typeof contact.advLat === 'number'
                ? contact.advLat / 1_000_000
                : null,

        lon:
            typeof contact.advLon === 'number'
                ? contact.advLon / 1_000_000
                : null,

        latRaw: contact.advLat,
        lonRaw: contact.advLon
    };
}


function loadKnownContacts() {
    const filepath =
        path.join(logDir, 'contacts.json');

    if (!fs.existsSync(filepath)) {
        return [];
    }

    try {
        const content =
            fs.readFileSync(filepath, 'utf8');

        return JSON.parse(content);
    } catch (error) {
        console.error(
            'Could not read contacts.json:',
            error
        );

        return [];
    }
}

function contactToRecord(contact, existing = null) {
    const now =
        new Date().toISOString();

    const publicKey =
        bytesToHex(contact.publicKey);

    return {
        name:
            contact.advName ?? existing?.name ?? null,

        publicKey,

        type:
            contact.type ?? existing?.type ?? null,

        flags:
            contact.flags ?? existing?.flags ?? null,

        outPathLen:
            contact.outPathLen ?? existing?.outPathLen ?? null,

        outPath:
            bytesToHex(
                contact.outPath?.slice(
                    0,
                    Math.max(
                        0,
                        contact.outPathLen ?? 0
                    )
                )
            ),

        lastAdvert:
            contact.lastAdvert ?? existing?.lastAdvert ?? null,

        lastMod:
            contact.lastMod ?? existing?.lastMod ?? null,

        lat:
            typeof contact.advLat === 'number'
                ? contact.advLat / 1_000_000
                : existing?.lat ?? null,

        lon:
            typeof contact.advLon === 'number'
                ? contact.advLon / 1_000_000
                : existing?.lon ?? null,

        latRaw:
            contact.advLat ?? existing?.latRaw ?? null,

        lonRaw:
            contact.advLon ?? existing?.lonRaw ?? null,

        firstSeen:
            existing?.firstSeen ?? now,

        lastSeen:
            now
    };
}

function mergeContacts(currentContacts) {
    const filepath =
        path.join(logDir, 'contacts.json');

    const knownContacts =
        loadKnownContacts();

    const byPublicKey =
        new Map();

    for (const contact of knownContacts) {
        if (!contact.publicKey) {
            continue;
        }

        byPublicKey.set(
            contact.publicKey,
            contact
        );
    }

    for (const contact of currentContacts) {
        const publicKey =
            bytesToHex(contact.publicKey);

        if (!publicKey) {
            continue;
        }

        const existing =
            byPublicKey.get(publicKey) ?? null;

        const merged =
            contactToRecord(
                contact,
                existing
            );

        byPublicKey.set(
            publicKey,
            merged
        );
    }

    const records =
        Array.from(
            byPublicKey.values()
        ).sort((a, b) => {
            return String(a.name ?? '')
                .localeCompare(
                    String(b.name ?? '')
                );
        });

    fs.writeFileSync(
        filepath,
        JSON.stringify(
            records,
            null,
            2
        ) + '\n'
    );

    console.log(
        `Merged ${currentContacts.length} current contacts into ${records.length} total known contacts`
    );
}

function formatLogJson(data) {
    const normalized = {
        ...data
    };

    let rawJson = null;

    if (normalized.raw) {
        rawJson = JSON.stringify(
            normalizeRawForLog(
                normalized.raw
            )
        );

        normalized.raw =
            '__RAW_OBJECT_PLACEHOLDER__';
    }

    let output =
        JSON.stringify(
            normalized,
            null,
            2
        );

    if (rawJson !== null) {
        output = output.replace(
            '"__RAW_OBJECT_PLACEHOLDER__"',
            rawJson
        );
    }

    return output;
}

function alreadyProcessed(dedupeId) {
    const now = Date.now();

    // Remove entries older than 10 minutes.
    for (const [id, timestamp] of recentlyProcessed) {
        if (now - timestamp > 10 * 60 * 1000) {
            recentlyProcessed.delete(id);
        }
    }

    if (recentlyProcessed.has(dedupeId)) {
        return true;
    }

    recentlyProcessed.set(
        dedupeId,
        now
    );

    return false;
}

function getMessageAgeSeconds(message) {
    const sentAtMs =
        message.senderTimestamp * 1000;

    return (
        Date.now() - sentAtMs
    ) / 1000;
}

function isMessageFresh(message) {
    const ageSeconds =
        getMessageAgeSeconds(message);

    // Protect against bad/future timestamps too.
    if (ageSeconds < 0) {
        return false;
    }

    return ageSeconds <= botMaxMessageAge;
}

async function handleBotResponse(enriched) {
    const response =
       await buildBotResponse(enriched);

    if (!response) {
        return;
    }

    const decision = {
        timestamp: new Date().toISOString(),

        channelIdx: enriched.channelIdx,
        channel: enriched.channel,

        sender: enriched.sender,
        trigger: enriched.text,

        response,

        hopCount: enriched.hopCount,
        snr: enriched.snr,

        transmitted: botSendEnabled,

        dedupeId: enriched.dedupeId
    };

    console.log('\nBOT RESPONSE:');
    console.log(response);

    if (!botSendEnabled) {
        console.log(
            'DRY RUN — not transmitted'
        );

        logBotDecision(decision);
        return;
    }

    console.log(
        `Sending response on ${enriched.channel}...`
    );

    await connection.sendChannelTextMessage(
        enriched.channelIdx,
        response
    );

    console.log('Response sent.');

    logBotDecision(decision);
}

async function onContactMessageReceived(message) {
    const receivedAt = new Date();

    const sentAt = message.senderTimestamp
        ? new Date(message.senderTimestamp * 1000)
        : null;

    let contact = null;

    try {
        contact =
            await connection.findContactByPublicKeyPrefix(
                message.pubKeyPrefix
            );
    } catch (error) {
        console.error(
            'Could not resolve direct-message sender:',
            error
        );
    }

    const pathInfo = decodePathLen(message.pathLen);

    const enriched = {
        receivedAt: receivedAt.toISOString(),
        sentAt: sentAt?.toISOString() ?? null,
        sender:
            contact?.advName ??
            contact?.name ??
            null,
        publicKeyPrefix:
            bytesToHex(message.pubKeyPrefix),
        text: message.text ?? null,
        snr: message.snr ?? null,
        routing: pathInfo.routing,
        hopCount: pathInfo.hopCount,
        pathHashSize: pathInfo.hashSize,
        pathLenRaw: message.pathLen ?? null,
        txtType: message.txtType ?? null,
        senderTimestamp:
            message.senderTimestamp ?? null,
        raw: message
    };

    console.log('\nReceived direct message:');
    console.dir(enriched, { depth: null });

    appendJsonLog(
        'direct-messages.log',
        enriched
    );
}

async function onChannelMessageReceived(message) {
    const receivedAt = new Date();

    const sentAt =
        new Date(message.senderTimestamp * 1000);

    const parsed =
        parseChannelText(message.text);

    const channelName =
        getChannelName(message.channelIdx);

    const pathInfo =
        decodePathLen(message.pathLen);

    const dedupeId =
        createDedupeId(message);

    const messageAgeSeconds =
        getMessageAgeSeconds(message);

    const enriched = {
        receivedAt:
            receivedAt.toISOString(),

        sentAt:
            sentAt.toISOString(),

        messageAgeSeconds:
            Math.round(messageAgeSeconds * 10) / 10,

        channelIdx:
            message.channelIdx,

        channel:
            channelName,

        sender:
            parsed.sender,

        text:
            parsed.text,

        rawText:
            message.text,

        snr:
            message.snr,

        routing:
            pathInfo.routing,

        hopCount:
            pathInfo.hopCount,

        pathHashSize:
            pathInfo.hashSize,

        pathLenRaw:
            message.pathLen,

        txtType:
            message.txtType,

        senderTimestamp:
            message.senderTimestamp,

        dedupeId,

        raw:
            message
    };

    console.log('\nReceived channel message:');

    console.dir(
        enriched,
        { depth: null }
    );

    // Always log channel traffic, even if it's old.
    logChannelMessage(
        channelName,
        enriched
    );


if (isBotTagged(enriched)) {
    logTaggedMessage({
        receivedAt: enriched.receivedAt,
        sentAt: enriched.sentAt,
        channelIdx: enriched.channelIdx,
        channel: enriched.channel,
        sender: enriched.sender,
        text: enriched.text,
        rawText: enriched.rawText,
        snr: enriched.snr,
        routing: enriched.routing,
        hopCount: enriched.hopCount,
        senderTimestamp: enriched.senderTimestamp,
        dedupeId: enriched.dedupeId
    });
}

    if (alreadyProcessed(dedupeId)) {
        console.log(
            'Duplicate packet — skipping bot processing'
        );

        return;
    }

    // Important:
    // queued/old messages still get logged,
    // but the bot will not respond to them.
    if (!isMessageFresh(message)) {
        console.log(
            `Old queued message (${Math.round(messageAgeSeconds)}s old) — skipping bot response`
        );

        return;
    }

    try {
        await handleBotResponse(
            enriched
        );
    } catch (error) {
        console.error(
            'Bot response error:',
            error
        );
    }
}

connection.on('connected', async () => {
    try {
        console.log(
            `Connected to MeshCore on ${port}`
        );

        await connection.syncDeviceTime();

        channels =
            await connection.getChannels();

        const contacts =
            await connection.getContacts();

        mergeContacts(contacts);

        console.log('\nConfigured channels:');

        channels
            .filter(channel => channel.name)
            .forEach(channel => {
                console.log(
                    `[${channel.channelIdx}] ${channel.name}`
                );
            });

        const selfInfo = await connection.getSelfInfo();

        console.log(
            'USB companion public key:',
            bytesToHex(selfInfo.publicKey)
        );

        console.log(
            `\nBot send enabled: ${botSendEnabled}`
        );

        console.log(
            `Bot trigger: "${botTrigger}"`
        );

        console.log(
            `Bot max message age: ${botMaxMessageAge} seconds`
        );

        console.log(
            '\nListening for channel messages...'
        );

    } catch (error) {
        console.error(
            'Startup error:',
            error
        );
    }
});

connection.on(
    Constants.PushCodes.MsgWaiting,
    async () => {
        try {
            const waitingMessages =
                await connection.getWaitingMessages();

            for (const message of waitingMessages) {
                if (message.contactMessage) {
                    await onContactMessageReceived(
                        message.contactMessage
                    );
                } else if (message.channelMessage) {
                    await onChannelMessageReceived(
                        message.channelMessage
                    );
                }
            }

        } catch (error) {
            console.error(
                'Error reading waiting messages:',
                error
            );
        }
    }
);

connection.on(
    Constants.PushCodes.NewAdvert,
    advert => {
        try {
            logAdvert(advert);
        } catch (error) {
            console.error(
                'Error logging advert:',
                error
            );
        }
    }
);

connection.on('disconnected', () => {
    console.log(
        'Disconnected from MeshCore'
    );
});

await connection.connect();