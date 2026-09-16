import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
    decodeReceivedChannelScope,
    getRegionKey,
    getScopeCandidates,
    makeMessageScopeKey
} from '../src/receivedScope.js';

function makeScopedPacket({channel, scopeName, timestamp, rawText}) {
    const plaintext = Buffer.alloc(5 + Buffer.byteLength(rawText));
    plaintext.writeUInt32LE(timestamp, 0);
    plaintext[4] = 0;
    plaintext.write(rawText, 5, 'utf8');

    const paddedLength = Math.ceil(plaintext.length / 16) * 16;
    const padded = Buffer.alloc(paddedLength);
    plaintext.copy(padded);

    const secret = Buffer.from(channel.secret);
    const cipher = crypto.createCipheriv('aes-128-ecb', secret, null);
    cipher.setAutoPadding(false);
    const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);

    const hmacKey = Buffer.alloc(32);
    secret.copy(hmacKey);
    const mac = crypto.createHmac('sha256', hmacKey)
        .update(ciphertext)
        .digest()
        .subarray(0, 2);

    const channelHash = crypto.createHash('sha256').update(secret).digest()[0];
    const payload = Buffer.concat([Buffer.from([channelHash]), mac, ciphertext]);
    const header = (5 << 2) | 0;
    const regionKey = getRegionKey(scopeName);
    let transportCode = crypto.createHmac('sha256', regionKey)
        .update(Buffer.concat([Buffer.from([5]), payload]))
        .digest()
        .readUInt16LE(0);

    if (transportCode === 0) transportCode = 1;
    if (transportCode === 0xffff) transportCode = 0xfffe;

    const transport = Buffer.alloc(4);
    transport.writeUInt16LE(transportCode, 0);
    transport.writeUInt16LE(0, 2);

    return Buffer.concat([
        Buffer.from([header]),
        transport,
        Buffer.from([0]),
        payload
    ]);
}

test('decodes us-ga from a raw scoped channel packet', () => {
    const channel = {
        channelIdx: 1,
        name: '#test',
        secret: Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    };

    const raw = makeScopedPacket({
        channel,
        scopeName: 'us-ga',
        timestamp: 1789551900,
        rawText: 'smiths16: test'
    });

    const decoded = decodeReceivedChannelScope(
        {raw, lastSnr: 4.5, lastRssi: -101},
        [channel],
        getScopeCandidates()
    );

    assert.equal(decoded.scopeName, 'us-ga');
    assert.equal(decoded.transportScoped, true);
    assert.equal(decoded.rawText, 'smiths16: test');
    assert.equal(
        makeMessageScopeKey(decoded),
        '1|1789551900|smiths16: test'
    );
});
