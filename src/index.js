import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildBotResponse, isBotTagged} from './botResponse.js';
import {
    decodeReceivedChannelScope,
    getRegionKey,
    getScopeCandidates,
    makeMessageScopeKey
} from './receivedScope.js';

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

const advertiseOnStart =
    String(process.env.ADVERTISE_ON_START ?? 'true').toLowerCase() === 'true';

const overwriteOldestContacts =
    String(process.env.OVERWRITE_OLDEST_CONTACTS ?? 'true').toLowerCase() === 'true';

const contactCapacity =
    Number(process.env.CONTACT_CAPACITY ?? 350);

const manageContacts =
    String(process.env.MANAGE_CONTACTS ?? 'true').toLowerCase() === 'true';

const replyWithReceivedScope =
    String(process.env.REPLY_WITH_RECEIVED_SCOPE ?? 'true').toLowerCase() === 'true';

const scopeCandidates =
    getScopeCandidates(process.env.REGION_SCOPES ?? '');

const favoriteContactTokens =
    String(process.env.CONTACT_FAVORITES ?? 'smiths16')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);

fs.mkdirSync(logDir, { recursive: true });

const connection = new NodeJSSerialConnection(port);

let channels = [];

// Serialise contact updates when several adverts arrive close together.
let advertProcessingQueue = Promise.resolve();

// Used to prevent responding twice to duplicate packets.
const recentlyProcessed = new Map();

// Raw RX packets contain region transport codes, while the queued-message API
// does not. Keep a short-lived correlation record until MsgWaiting is drained.
const receivedChannelScopes = new Map();

// setFloodScope is device state. Serialize set/send/clear transactions so two
// replies received close together cannot use each other's scope.
let scopedSendQueue = Promise.resolve();

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

function isFavoriteContact(contact) {
    const name =
        String(contact.advName ?? contact.name ?? '')
            .trim()
            .toLowerCase();

    const publicKey =
        bytesToHex(contact.publicKey).toLowerCase();

    return favoriteContactTokens.includes(name) ||
        favoriteContactTokens.includes(publicKey);
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

function rememberReceivedChannelScope(scopeRecord) {
    const now = Date.now();

    for (const [key, record] of receivedChannelScopes) {
        if (now - record.capturedAt > 10 * 60 * 1000) {
            receivedChannelScopes.delete(key);
        }
    }

    receivedChannelScopes.set(
        makeMessageScopeKey(scopeRecord),
        scopeRecord
    );
}

function takeReceivedChannelScope(message) {
    const key = makeMessageScopeKey({
        channelIdx: message.channelIdx,
        senderTimestamp: message.senderTimestamp,
        rawText: message.text
    });

    const record = receivedChannelScopes.get(key) ?? null;

    if (record) {
        receivedChannelScopes.delete(key);
    }

    return record;
}

function setFloodScopeUnscoped() {
    return new Promise(async (resolve, reject) => {
        const cleanup = () => {
            connection.off(Constants.ResponseCodes.Ok, onOk);
            connection.off(Constants.ResponseCodes.Err, onErr);
        };

        const onOk = response => {
            cleanup();
            resolve(response);
        };

        const onErr = response => {
            cleanup();
            reject(new Error(
                `USB companion rejected unscoped flood mode${response?.errCode === null || response?.errCode === undefined ? '' : ` (error ${response.errCode})`}`
            ));
        };

        connection.once(Constants.ResponseCodes.Ok, onOk);
        connection.once(Constants.ResponseCodes.Err, onErr);

        try {
            // Companion protocol v12+: SET_FLOOD_SCOPE, variant 1 explicitly
            // forces unscoped sending even when the radio has a default scope.
            await connection.sendToRadioFrame(
                new Uint8Array([
                    Constants.CommandCodes.SetFloodScope,
                    1
                ])
            );
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
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

async function storeAdvertContact(advert) {
    if (!manageContacts) {
        return;
    }

    const publicKey =
        bytesToHex(advert.publicKey);

    let currentContacts =
        await connection.getContacts();

    const existingContact =
        currentContacts.find(contact => {
            return bytesToHex(contact.publicKey) === publicKey;
        });

    let removedContact = null;

    if (!existingContact && currentContacts.length >= contactCapacity) {
        if (!overwriteOldestContacts) {
            const record = {
                timestamp: new Date().toISOString(),
                action: 'skipped-full',
                capacity: contactCapacity,
                incomingName: advert.advName ?? null,
                incomingPublicKey: publicKey
            };

            console.log(
                `Contact list full; skipped new contact ${advert.advName ?? publicKey}`
            );

            appendJsonLog(
                'contact-management.log',
                record
            );

            return;
        }

        const removableContacts =
            currentContacts.filter(contact => {
                return !isFavoriteContact(contact);
            });

        const oldestContact =
            [...removableContacts].sort((a, b) => {
                return (a.lastAdvert ?? 0) - (b.lastAdvert ?? 0);
            })[0];

        if (!oldestContact) {
            throw new Error(
                'Contact list is full but every contact is protected as a favorite'
            );
        }

        removedContact = {
            name: oldestContact.advName ?? null,
            publicKey: bytesToHex(oldestContact.publicKey),
            lastAdvert: oldestContact.lastAdvert ?? null
        };

        console.log(
            `Contact list full; replacing oldest contact ${removedContact.name ?? removedContact.publicKey}`
        );

        await connection.removeContact(
            oldestContact.publicKey
        );
    }

    await connection.addOrUpdateContact(
        advert.publicKey,
        advert.type,
        advert.flags,
        advert.outPathLen,
        advert.outPath,
        advert.advName,
        advert.lastAdvert,
        advert.advLat,
        advert.advLon
    );

    currentContacts =
        await connection.getContacts();

    mergeContacts(currentContacts);

    const record = {
        timestamp: new Date().toISOString(),
        action:
            existingContact
                ? 'updated'
                : removedContact
                    ? 'replaced-oldest'
                    : 'added',
        capacity: contactCapacity,
        contactCount: currentContacts.length,
        incomingName: advert.advName ?? null,
        incomingPublicKey: publicKey,
        incomingFavorite: isFavoriteContact(advert),
        removedContact
    };

    console.log(
        `Stored advertised contact ${advert.advName ?? publicKey}`
    );

    appendJsonLog(
        'contact-management.log',
        record
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

        receivedScope:
            enriched.transportScoped
                ? enriched.scopeName
                : 'unscoped',
        transportScoped: enriched.transportScoped,

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

    if (replyWithReceivedScope && !enriched.scopeCaptured) {
        decision.transmitted = false;
        decision.skipReason = 'received-scope-metadata-missing';

        console.log(
            'Scope metadata was not captured — skipping reply to avoid using the wrong scope.'
        );

        logBotDecision(decision);
        return;
    }

    if (
        replyWithReceivedScope &&
        enriched.transportScoped &&
        !enriched.scopeName
    ) {
        decision.transmitted = false;
        decision.skipReason = 'received-scope-name-unknown';

        console.log(
            `Unknown received scope code ${enriched.transportCode1} — skipping reply instead of sending unscoped.`
        );

        logBotDecision(decision);
        return;
    }

    console.log(
        `Sending response on ${enriched.channel}...`
    );

    if (replyWithReceivedScope) {
        const sendTask = scopedSendQueue.then(async () => {
            if (enriched.transportScoped) {
                console.log(`Reply scope: ${enriched.scopeName}`);

                await connection.setFloodScope(
                    getRegionKey(enriched.scopeName)
                );
            } else {
                console.log('Reply scope: unscoped');
                await setFloodScopeUnscoped();
            }

            try {
                await connection.sendChannelTextMessage(
                    enriched.channelIdx,
                    response
                );
            } finally {
                // Return to the radio's configured default scope immediately.
                await connection.clearFloodScope();
            }
        });

        scopedSendQueue = sendTask.catch(() => {});
        await sendTask;
    } else {
        await connection.sendChannelTextMessage(
            enriched.channelIdx,
            response
        );
    }

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

    const receivedScope =
        takeReceivedChannelScope(message);

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

        scopeCaptured:
            receivedScope !== null,

        transportScoped:
            receivedScope?.transportScoped ?? null,

        scopeName:
            receivedScope?.scopeName ?? null,

        transportCode1:
            receivedScope?.transportCode1 ?? null,

        transportCode2:
            receivedScope?.transportCode2 ?? null,

        dedupeId,

        raw:
            message
    };

    console.log('\nReceived channel message:');

    console.dir(
        enriched,
        { depth: null }
    );

    if (receivedScope?.transportScoped) {
        console.log(
            `Received scope: ${receivedScope.scopeName ?? `unknown (${receivedScope.transportCode1})`}`
        );
    } else if (receivedScope) {
        console.log('Received scope: unscoped');
    }

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
            `USB companion contact mode: ${selfInfo.manualAddContacts ? 'manual/host-managed' : 'automatic/firmware-managed'}`
        );

        if (manageContacts && !selfInfo.manualAddContacts) {
            console.log(
                'Enabling host-managed contacts for overwrite-oldest support...'
            );

            await connection.setManualAddContacts();

            console.log(
                'Host-managed contacts enabled.'
            );
        }

        if (advertiseOnStart) {
            console.log(
                'Sending USB companion flood advertisement...'
            );

            await connection.sendFloodAdvert();

            console.log(
                'USB companion advertisement sent.'
            );
        } else {
            console.log(
                'USB companion startup advertisement disabled.'
            );
        }

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
            `Contact management: ${manageContacts ? 'enabled' : 'disabled'}`
        );

        console.log(
            `Received-scope replies: ${replyWithReceivedScope ? 'enabled' : 'disabled'}`
        );

        if (replyWithReceivedScope) {
            console.log(
                `Known public region scopes: ${scopeCandidates.length}`
            );
        }

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
    Constants.PushCodes.LogRxData,
    event => {
        try {
            const scopeRecord = decodeReceivedChannelScope(
                event,
                channels,
                scopeCandidates
            );

            if (scopeRecord) {
                rememberReceivedChannelScope(scopeRecord);
            }
        } catch (error) {
            console.error(
                'Error decoding received packet scope:',
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

            advertProcessingQueue =
                advertProcessingQueue
                    .then(() => storeAdvertContact(advert))
                    .catch(error => {
                        console.error(
                            'Error storing advertised contact:',
                            error
                        );
                    });
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
