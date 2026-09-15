#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const projectDir = path.dirname(
    fileURLToPath(import.meta.url)
);

dotenv.config({
    path: path.join(projectDir, '.env')
});

const requestedCount =
    Number.parseInt(process.argv[2] ?? '10', 10);

if (
    !Number.isInteger(requestedCount) ||
    requestedCount < 1
) {
    console.error(
        'Usage: ./show-dms [number-of-messages]'
    );
    process.exit(1);
}

const configuredLogDir =
    process.env.LOG_DIR ?? './logs';

const logDir = path.isAbsolute(configuredLogDir)
    ? configuredLogDir
    : path.resolve(projectDir, configuredLogDir);

const logFile =
    path.join(logDir, 'direct-messages.log');

if (!fs.existsSync(logFile)) {
    console.error(
        `No direct-message log found at ${logFile}`
    );
    process.exit(1);
}

const records = fs.readFileSync(logFile, 'utf8')
    .split(/\n\s*\n/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .flatMap(entry => {
        try {
            return [JSON.parse(entry)];
        } catch {
            return [];
        }
    });

const messages =
    records.slice(-requestedCount);

if (messages.length === 0) {
    console.log('No direct messages have been logged.');
    process.exit(0);
}

for (const message of messages) {
    console.log('----------------------------------------');
    console.log(
        `Received: ${message.receivedAt ?? 'unknown'}`
    );
    console.log(
        `Sent:     ${message.sentAt ?? 'unknown'}`
    );
    console.log(
        `From:     ${message.sender ?? 'unknown contact'}`
    );

    if (message.publicKeyPrefix) {
        console.log(
            `Key:      ${message.publicKeyPrefix}`
        );
    }

    if (message.snr !== null && message.snr !== undefined) {
        console.log(
            `SNR:      ${message.snr}`
        );
    }

    console.log(
        `Message:  ${message.text ?? ''}`
    );
}

console.log('----------------------------------------');
console.log(
    `Showing ${messages.length} of ${records.length} direct messages.`
);