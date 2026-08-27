import fs from 'node:fs';
import path from 'node:path';

export function ensureLogDir(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
}

function safeFilename(name) {
  return name
    .replace(/^#/, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .toLowerCase();
}

export function logChannelMessage(logDir, channelName, message) {
  const filename = `${safeFilename(channelName)}.log`;
  const filepath = path.join(logDir, filename);

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...message,
  });

  fs.appendFileSync(filepath, `${line}\n`);
}

export function logDryRun(logDir, entry) {
  const filepath = path.join(logDir, 'bot-dry-run.log');

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });

  fs.appendFileSync(filepath, `${line}\n`);
}
