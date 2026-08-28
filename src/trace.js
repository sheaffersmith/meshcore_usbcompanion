import 'dotenv/config';

import NodeJSSerialConnection
    from '../node_modules/@liamcottle/meshcore.js/src/connection/nodejs_serial_connection.js';

function getArg(name) {
    const index = process.argv.indexOf(`--${name}`);

    if (index === -1) {
        return null;
    }

    return process.argv[index + 1] ?? null;
}

function parsePath(pathString) {
    if (!pathString) {
        return null;
    }

    const parts = pathString
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

    const bytes = parts.map(value => {
        const byte = Number.parseInt(value, 16);

        if (
            Number.isNaN(byte) ||
            byte < 0 ||
            byte > 255
        ) {
            throw new Error(
                `Invalid path byte: ${value}`
            );
        }

        return byte;
    });

    return new Uint8Array(bytes);
}

function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(byte =>
            byte
                .toString(16)
                .padStart(2, '0')
                .toUpperCase()
        )
        .join(' ');
}

function decodeSnrs(bytes) {
    return Array.from(bytes).map(byte => {
        const signed =
            byte > 127
                ? byte - 256
                : byte;

        return signed / 4;
    });
}

const port =
    getArg('port') ??
    process.env.MESHCORE_PORT ??
    '/dev/ttyACM1';

const contactName =
    getArg('contact');

const manualPathString =
    getArg('path');

if (!contactName && !manualPathString) {
    throw new Error(
        'Provide either --contact "Name" or --path "AA,BB,CC"'
    );
}

const connection =
    new NodeJSSerialConnection(port);

connection.on('connected', async () => {
    try {
        console.log(
            `Connected to ${port}`
        );

        let path;

        if (manualPathString) {

            path =
                parsePath(manualPathString);

            console.log(
                `Manual path: ${bytesToHex(path)}`
            );

        } else {

            const contacts =
                await connection.getContacts();

            const contact =
                contacts.find(
                    contact =>
                        contact.advName === contactName
                );

            if (!contact) {
                throw new Error(
                    `Contact not found: ${contactName}`
                );
            }

            console.log(
                `Contact: ${contact.advName}`
            );

            console.log(
                `Stored path length: ${contact.outPathLen}`
            );

            if (contact.outPathLen < 0) {
                throw new Error(
                    'Contact currently uses flood routing and has no stored direct path'
                );
            }

            path =
                contact.outPath.slice(
                    0,
                    contact.outPathLen
                );

            console.log(
                `Stored path: ${bytesToHex(path)}`
            );
        }

        console.log(
            '\nSending trace...'
        );

        const trace =
            await connection.tracePath(
                path,
                5000
            );

        const snrs =
            decodeSnrs(trace.pathSnrs);

        console.log(
            '\nTrace result'
        );

        console.log(
            `Path length: ${trace.pathLen}`
        );

        console.log(
            `Path hashes: ${bytesToHex(trace.pathHashes)}`
        );

        console.log(
            `Hop SNRs: ${
                snrs
                    .map(
                        (snr, index) =>
                            `${index + 1}: ${snr} dB`
                    )
                    .join(', ')
            }`
        );

        console.log(
            `Final SNR: ${trace.lastSnr} dB`
        );

        console.log(
            '\nRaw trace:'
        );

        console.dir(
            trace,
            { depth: null }
        );

        await connection.close();

        process.exit(0);

    } catch (error) {
        console.error(
            '\nTrace failed:',
            error
        );

        await connection
            .close()
            .catch(() => {});

        process.exit(1);
    }
});

await connection.connect();