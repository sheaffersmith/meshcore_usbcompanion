import 'dotenv/config';
import crypto from 'node:crypto';

import NodeJSSerialConnection
    from '../node_modules/@liamcottle/meshcore.js/src/connection/nodejs_serial_connection.js';

function getArg(name) {
    const index = process.argv.indexOf(`--${name}`);

    if (index === -1) {
        return null;
    }

    return process.argv[index + 1] ?? null;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function deriveHashtagSecret(channelName) {
    const hash = crypto
        .createHash('sha256')
        .update(channelName, 'utf8')
        .digest();

    return new Uint8Array(hash.subarray(0, 16));
}

function formatSecret(secret) {
    return Buffer.from(secret).toString('hex');
}

const port =
    getArg('port') ??
    process.env.MESHCORE_PORT ??
    '/dev/ttyACM1';

const channelIndexArg = getArg('channel-index');
const channelName = getArg('channel-name');
const suppliedSecret = getArg('channel-secret');

const listOnly = hasFlag('list');

const connection = new NodeJSSerialConnection(port);

connection.on('connected', async () => {
    try {
        console.log(`Connected to ${port}`);

        const existingChannels = await connection.getChannels();

        if (listOnly) {
            console.log('\nConfigured channels:');

            existingChannels.forEach((channel, index) => {
                console.log(
                    `[${index}] ${channel.name || '(empty)'}`
                );
            });

            await connection.close();
            process.exit(0);
        }

        if (channelIndexArg === null) {
            throw new Error(
                'You must provide --channel-index'
            );
        }

        const channelIndex = Number(channelIndexArg);

        if (!Number.isInteger(channelIndex) || channelIndex < 0) {
            throw new Error(
                '--channel-index must be a non-negative integer'
            );
        }

        if (!channelName) {
            throw new Error(
                'You must provide --channel-name'
            );
        }

        let secret;

        if (channelName.startsWith('#')) {

            secret = deriveHashtagSecret(channelName);

            console.log(
                `Hashtag channel detected: ${channelName}`
            );

            console.log(
                `Derived secret: ${formatSecret(secret)}`
            );

        } else {

            if (!suppliedSecret) {
                throw new Error(
                    'Non-hashtag channels require --channel-secret'
                );
            }

            if (!/^[0-9a-fA-F]{32}$/.test(suppliedSecret)) {
                throw new Error(
                    '--channel-secret must be exactly 32 hex characters'
                );
            }

            secret = new Uint8Array(
                Buffer.from(suppliedSecret, 'hex')
            );
        }

        console.log('\nChannels before:');

        existingChannels.forEach((channel, index) => {
            console.log(
                `[${index}] ${channel.name || '(empty)'}`
            );
        });

        console.log(
            `\nSetting channel ${channelIndex} to "${channelName}"...`
        );

        await connection.setChannel(
            channelIndex,
            channelName,
            secret
        );

        console.log('Channel saved.');

        const updatedChannels = await connection.getChannels();

        console.log('\nChannels after:');

        updatedChannels.forEach((channel, index) => {
            console.log(
                `[${index}] ${channel.name || '(empty)'}`
            );
        });

        const savedChannel = updatedChannels[channelIndex];

        if (savedChannel) {
            console.log('\nSaved channel details:');
            console.dir(savedChannel, { depth: null });
        }

        await connection.close();

        process.exit(0);

    } catch (error) {
        console.error('\nChannel setup failed:');
        console.error(error);

        await connection.close().catch(() => {});

        process.exit(1);
    }
});

connection.on('disconnected', () => {
    console.log('Disconnected from MeshCore');
});

await connection.connect();
