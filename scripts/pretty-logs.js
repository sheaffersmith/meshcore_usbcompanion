import fs from 'node:fs';
import path from 'node:path';

const logDir = './logs';

function numericObjectToHex(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
    ) {
        return value;
    }

    const keys = Object.keys(value);

    if (keys.length === 0) {
        return value;
    }

    // Is this an object like:
    // {"0":151,"1":96,"2":219,...} ?
    const numericKeys = keys.every(
        key => /^\d+$/.test(key)
    );

    if (!numericKeys) {
        return value;
    }

    const numbers = keys
        .sort((a, b) => Number(a) - Number(b))
        .map(key => value[key]);

    const validBytes = numbers.every(
        number =>
            Number.isInteger(number) &&
            number >= 0 &&
            number <= 255
    );

    if (!validBytes) {
        return value;
    }

    return Buffer
        .from(numbers)
        .toString('hex');
}

function normalizeRaw(raw) {
    if (!raw || typeof raw !== 'object') {
        return raw;
    }

    const normalized = {
        ...raw
    };

    if (normalized.publicKey) {
        normalized.publicKey =
            numericObjectToHex(
                normalized.publicKey
            );
    }

    if (normalized.outPath) {
        normalized.outPath =
            numericObjectToHex(
                normalized.outPath
            );
    }

    return normalized;
}

/*
 * Parse multiple JSON objects from a file.
 *
 * Works with:
 *   {"a":1}
 *   {"b":2}
 *
 * and:
 *
 *   {
 *     "a": 1
 *   }
 *
 *   {
 *     "b": 2
 *   }
 */
function splitJsonObjects(content) {
    const objects = [];

    let start = null;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            if (depth === 0) {
                start = i;
            }

            depth++;
            continue;
        }

        if (char === '}') {
            depth--;

            if (depth === 0 && start !== null) {
                const json =
                    content.slice(start, i + 1);

                objects.push(
                    JSON.parse(json)
                );

                start = null;
            }
        }
    }

    if (depth !== 0) {
        throw new Error(
            'File contains incomplete JSON'
        );
    }

    return objects;
}

/*
 * Pretty-print everything EXCEPT "raw".
 *
 * "raw" gets replaced with a placeholder first,
 * then inserted back as compact JSON.
 */
function formatRecord(record) {
    const normalized = {
        ...record
    };

    let rawJson = null;

    if (normalized.raw) {
        const raw =
            normalizeRaw(normalized.raw);

        rawJson =
            JSON.stringify(raw);

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

if (!fs.existsSync(logDir)) {
    throw new Error(
        `Log directory does not exist: ${logDir}`
    );
}

const files = fs
    .readdirSync(logDir)
    .filter(file => file.endsWith('.log'))
    .map(file => path.join(logDir, file));

if (files.length === 0) {
    console.log('No .log files found.');
    process.exit(0);
}

for (const file of files) {
    const content =
        fs.readFileSync(
            file,
            'utf8'
        ).trim();

    if (!content) {
        console.log(
            `Skipping empty file: ${file}`
        );

        continue;
    }

    console.log(
        `Processing ${file}...`
    );

    const records =
        splitJsonObjects(content);

    const formatted =
        records
            .map(formatRecord)
            .join('\n\n') + '\n';

    fs.writeFileSync(
        file,
        formatted
    );

    console.log(
        `  ${records.length} records converted`
    );
}

console.log('\nDone.');