'use strict';
// Room-local diagnostics only. No analytics, tracking identifiers or disk logging.
const STICKERS = new Set(['hype', 'lol', 'void', 'gg', 'cry', 'love', 'wow', 'rip']);
function number(value, fallback, low, high) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value)) : fallback;
}
function stats(value, at) {
  return {rttMs: number(value.rttMs, 0, 0, 60000),
    driftMs: number(value.driftMs, 0, -60000, 60000),
    playerState: typeof value.playerState === 'string'
      ? value.playerState.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 32) : 'unknown',
    updatedAt: at};
}
function sticker(text) {
  for (const match of text.matchAll(/:([a-z]+):/g)) if (STICKERS.has(match[1])) return match[1];
  return '';
}
// A single RFC byte range. Multiple ranges are not supported, never concatenated.
function range(value, size) {
  const reject = () => { const e = new Error('Requested byte range is not available.'); e.status = 416; throw e; };
  if (!Number.isSafeInteger(size) || size < 0) throw Error('Invalid file size');
  if (value === undefined) return {start: 0, end: size - 1, status: 200};
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value));
  if (!match || (!match[1] && !match[2]) || !size) return reject();
  let start, end;
  if (!match[1]) {
    const tail = Number(match[2]);
    if (!Number.isSafeInteger(tail) || tail <= 0) return reject();
    start = Math.max(0, size - tail); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return reject();
    end = Math.min(end, size - 1);
  }
  return {start, end, status: 206};
}
module.exports = {stats, sticker, range};
