import crypto from 'node:crypto';

import Packet from '../node_modules/@liamcottle/meshcore.js/src/packet.js';

const US_SUBDIVISIONS = [
    'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl',
    'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me',
    'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh',
    'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
    'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi',
    'wy', 'as', 'gu', 'mp', 'pr', 'um', 'vi'
];

export function getScopeCandidates(extraScopes = '') {
    const scopes = new Set([
        'us',
        ...US_SUBDIVISIONS.map(code => `us-${code}`)
    ]);

    String(extraScopes)
        .split(',')
        .map(value => value.trim().replace(/^#/, '').toLowerCase())
        .filter(Boolean)
        .forEach(value => scopes.add(value));

    return [...scopes];
}

export function getRegionKey(scopeName) {
    const normalized = String(scopeName).replace(/^#/, '').toLowerCase();

    return crypto
        .createHash('sha256')
        .update(`#${normalized}`, 'utf8')
        .digest()
        .subarray(0, 16);
}

function calculateTransportCode(regionKey, packet) {
    const data = Buffer.concat([
        Buffer.from([packet.payload_type]),
        Buffer.from(packet.payload)
    ]);

    let code = crypto
        .createHmac('sha256', regionKey)
        .update(data)
        .digest()
        .readUInt16LE(0);

    if (code === 0) {
        code = 1;
    } else if (code === 0xffff) {
        code = 0xfffe;
    }

    return code;
}

function resolveScopeName(packet, candidates) {
    if (packet.transportCode1 === null) {
        return null;
    }

    for (const scopeName of candidates) {
        const regionKey = getRegionKey(scopeName);

        if (calculateTransportCode(regionKey, packet) === packet.transportCode1) {
            return scopeName;
        }
    }

    return null;
}

function decryptChannelPayload(packet, channels) {
    if (packet.payload_type !== Packet.PAYLOAD_TYPE_GRP_TXT) {
        return null;
    }

    const payload = Buffer.from(packet.payload);

    if (payload.length < 19) {
        return null;
    }

    const channelHash = payload[0];
    const receivedMac = payload.subarray(1, 3);
    const ciphertext = payload.subarray(3);

    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
        return null;
    }

    for (const channel of channels) {
        const secret = Buffer.from(channel.secret ?? []);

        if (secret.length !== 16) {
            continue;
        }

        const expectedChannelHash = crypto
            .createHash('sha256')
            .update(secret)
            .digest()[0];

        if (expectedChannelHash !== channelHash) {
            continue;
        }

        // Companion firmware stores 128-bit channel keys in a zero-padded
        // 256-bit buffer and uses that full buffer as the HMAC key.
        const hmacKey = Buffer.alloc(32);
        secret.copy(hmacKey);

        const expectedMac = crypto
            .createHmac('sha256', hmacKey)
            .update(ciphertext)
            .digest()
            .subarray(0, 2);

        if (!crypto.timingSafeEqual(receivedMac, expectedMac)) {
            continue;
        }

        const decipher = crypto.createDecipheriv(
            'aes-128-ecb',
            secret,
            null
        );

        decipher.setAutoPadding(false);

        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);

        if (plaintext.length < 5) {
            continue;
        }

        const nulIndex = plaintext.indexOf(0, 5);
        const textEnd = nulIndex === -1 ? plaintext.length : nulIndex;

        return {
            channelIdx: channel.channelIdx,
            senderTimestamp: plaintext.readUInt32LE(0),
            txtType: plaintext[4],
            rawText: plaintext.subarray(5, textEnd).toString('utf8')
        };
    }

    return null;
}

export function makeMessageScopeKey(message) {
    return [
        message.channelIdx,
        message.senderTimestamp,
        message.rawText ?? message.text
    ].join('|');
}

export function decodeReceivedChannelScope(event, channels, candidates) {
    const packet = Packet.fromBytes(event.raw);
    const decoded = decryptChannelPayload(packet, channels);

    if (!decoded) {
        return null;
    }

    const transportScoped = packet.transportCode1 !== null;
    const scopeName = resolveScopeName(packet, candidates);

    return {
        ...decoded,
        transportScoped,
        scopeName,
        transportCode1: packet.transportCode1,
        transportCode2: packet.transportCode2,
        pathLen: packet.pathLen,
        snr: event.lastSnr ?? null,
        rssi: event.lastRssi ?? null,
        capturedAt: Date.now()
    };
}
