import 'dotenv/config';

import NodeJSSerialConnection
    from '../node_modules/@liamcottle/meshcore.js/src/connection/nodejs_serial_connection.js';

const args = process.argv.slice(2);

const channelName = args[0];
const message = args.slice(1).join(' ');

if (!channelName) {
    throw new Error('First argument must be the channel name');
}

if (!message) {
    throw new Error('You must provide a message');
}

const port =
    process.env.MESHCORE_PORT ??
    '/dev/ttyACM1';

const connection = new NodeJSSerialConnection(port);

connection.on('connected', async () => {
    try {
        const channels = await connection.getChannels();

        const channel = channels.find(
            channel => channel.name === channelName
        );

        if (!channel) {
            console.error(`Channel not found: ${channelName}`);

            console.log('\nConfigured channels:');

            channels
                .filter(channel => channel.name)
                .forEach(channel => {
                    console.log(
                        `[${channel.channelIdx}] ${channel.name}`
                    );
                });

            throw new Error('Unknown channel');
        }

        console.log(
            `Sending to ${channel.name} [${channel.channelIdx}]:`
        );

        console.log(message);

        await connection.sendChannelTextMessage(
            channel.channelIdx,
            message
        );

        console.log('Sent.');

        setTimeout(async () => {
            await connection.close();
            process.exit(0);
        }, 500);

    } catch (error) {
        console.error('Send failed:', error);

        await connection.close().catch(() => {});
        process.exit(1);
    }
});

await connection.connect();