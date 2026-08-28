import 'dotenv/config';

import NodeJSSerialConnection
    from '../node_modules/@liamcottle/meshcore.js/src/connection/nodejs_serial_connection.js';

const newName = process.argv.slice(2).join(' ').trim();

if (!newName) {
    throw new Error(
        'Usage: node src/setup-name.js "Pinehurst-MeshBot"'
    );
}

const port =
    process.env.MESHCORE_PORT ??
    '/dev/ttyACM1';

const connection = new NodeJSSerialConnection(port);

connection.on('connected', async () => {
    try {
        console.log(`Connected to ${port}`);
        console.log(`Setting name to: ${newName}`);

        await connection.setAdvertName(newName);

        console.log('Name saved.');

        await connection.close();
        process.exit(0);

    } catch (error) {
        console.error('Name change failed:', error);

        await connection.close().catch(() => {});
        process.exit(1);
    }
});

await connection.connect();