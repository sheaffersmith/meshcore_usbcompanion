export function buildDryRunResponse(message) {
  const text = message.text?.trim().toLowerCase();

  if (text === 'test') {
    return `Test received. SNR: ${message.snr ?? 'unknown'} dB`;
  }

  if (text === 'test full') {
    return [
      'Test received.',
      `SNR: ${message.snr ?? 'unknown'} dB`,
      `Path length: ${message.pathLength ?? 'unknown'}`,
      `Path: ${message.path ?? 'unknown'}`,
    ].join(' ');
  }

  return null;
}
