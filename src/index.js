import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import Constants from '../node_modules/@liamcottle/meshcore.js/src/constants.js';
import NodeJSSerialConnection from '../node_modules/@liamcottle/meshcore.js/src/connection/nodejs_serial_connection.js';

const port = process.env.MESHCORE_PORT ?? '/dev/ttyACM0';
const logDir = process.env.LOG_DIR ?? './logs';

fs.mkdirSync(logDir, { recursive: true });

const connection = new NodeJSSerialConnection(port);

function safeFilename(value) {
    return String(value)
        .replace(/[^a-z0-9_-]+/gi, '_')
        .toLowerCase();
}

function appendJsonLog(filename, data) {
    const filepath = path.join(logDir, filename);

    fs.appendFileSync(
        filepath,
        JSON.stringify({
            loggedAt: new Date().toISOString(),
            ...data,
        }) + '\n'
    );
}

async function onChannelMessageReceived(message) {
    console.log('Received channel message:');
    console.dir(message, { depth: null });

    // Until we confirm the exact field name, use whatever channel
    // index-like value the message exposes.
    const channel =
        message.channelIdx ??
        message.channelIndex ??
        message.channel ??
        'unknown';

    const filename = `channel-${safeFilename(channel)}.log`;

    appendJsonLog(filename, {
        type: 'channel-message',
        message,
    });
}

connection.on('connected', async () => {
    console.log(`Connected to MeshCore on ${port}`);

    // Keep the radio's clock synchronized.
    await connection.syncDeviceTime();

    console.log('Listening for channel messages...');
});

connection.on('disconnected', () => {
    console.log('Disconnected from MeshCore');
});

connection.on(Constants.PushCodes.MsgWaiting, async () => {
    try {
        const waitingMessages = await connection.getWaitingMessages();

        for (const message of waitingMessages) {
            if (message.channelMessage) {
                await onChannelMessageReceived(message.channelMessage);
            }
        }
    } catch (error) {
        console.error('Error reading waiting messages:', error);
    }
});

await connection.connect();
