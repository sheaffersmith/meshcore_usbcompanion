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

const port =
    getArg('port') ??
    process.env.MESHCORE_PORT ??
    '/dev/ttyACM1';

const frequencyMhz = Number(getArg('frequency'));
const bandwidthKhz = Number(getArg('bandwidth'));
const sf = Number(getArg('sf'));
const cr = Number(getArg('cr'));

if (!frequencyMhz || !bandwidthKhz || !sf || !cr) {
    throw new Error(
        'Required: --frequency --bandwidth --sf --cr'
    );
}

// MeshCore expects these as integer values:
//
// 910.525 MHz -> 910525
// 62.5 kHz    -> 62500
const radioFreq = Math.round(frequencyMhz * 1000);
const radioBw = Math.round(bandwidthKhz * 1000);

const connection = new NodeJSSerialConnection(port);

connection.on('connected', async () => {
    try {
        console.log(`Connected to ${port}`);

        console.log('Setting radio profile:');
        console.log(
            `  Frequency: ${frequencyMhz} MHz (${radioFreq})`
        );
        console.log(
            `  Bandwidth: ${bandwidthKhz} kHz (${radioBw})`
        );
        console.log(`  SF: ${sf}`);
        console.log(`  CR: ${cr}`);

        await connection.setRadioParams(
            radioFreq,
            radioBw,
            sf,
            cr
        );

        console.log('Radio parameters saved.');

        await connection.close();
        process.exit(0);

    } catch (error) {
        console.error('Radio setup failed:', error);

        await connection.close().catch(() => {});
        process.exit(1);
    }
});

await connection.connect();