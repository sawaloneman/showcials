'use strict';
/** Native Roku voice bridge. Volatile PCM only; no filesystem or recording API.
 * 16 kHz mono signed-16 LE. Frame=20 ms=640 bytes. Receivers mix at pull time.
 * This is bounded, best-effort conversational audio, NOT a gapless audio engine.
 */
const crypto = require('node:crypto');
const FRAME = 640, MAX_FRAMES = 25, STALE_MS = 750;
const problem = (status, message) => Object.assign(new Error(message), {status});
function wav(pcm) {
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]);
}
class NativeVoice {
  constructor({notify = () => {}, broadcast = () => {}, clock = Date.now} = {}) {
    this.sessions = new Map(); this.notify = notify; this.broadcast = broadcast; this.clock = clock;
  }
  roster(room) {
    return [...this.sessions.values()].filter(s => s.room === room).map(s =>
      ({id:s.id, clientId:s.clientId, name:s.name, muted:s.muted, transport:'roku-rest'}));
  }
  open(room, member, body, existingVoiceCount) {
    if (member.kind !== 'roku') throw problem(403, 'Native voice requires a Roku room session.');
    if (body.adultNonChildSession !== true) throw problem(403, 'Adult, non-child-directed session consent is required.');
    const previous = this.roster(room).filter(s => s.clientId === member.id).length;
    this.closeMember(room, member.id);
    if (existingVoiceCount - previous >= 12) throw problem(409, 'Voice room full (12).');
    const s = {id:crypto.randomBytes(18).toString('hex'), room, clientId:member.id, name:member.name,
      secret:crypto.randomBytes(24).toString('hex'), lastSeen:this.clock(), seq:0, muted:true,
      sources:new Map(), frameWindow:this.clock(), windowFrames:0};
    this.sessions.set(s.id, s); this.notify(room);
    return {ok:true, voiceId:s.id, voiceSecret:s.secret, format:'pcm-s16-le', sampleRate:16000,
      channels:1, frameBytes:FRAME, maxFrames:MAX_FRAMES, recommendedBatchFrames:10};
  }
  session(room, member, body) {
    const s = this.sessions.get(body.voiceId);
    if (!s || s.room !== room || s.clientId !== member.id ||
        typeof body.voiceSecret !== 'string' || body.voiceSecret.length !== s.secret.length || Buffer.byteLength(body.voiceSecret) !== Buffer.byteLength(s.secret) ||
        !crypto.timingSafeEqual(Buffer.from(body.voiceSecret), Buffer.from(s.secret)))
      throw problem(401, 'Voice session expired or not authorized.');
    s.lastSeen = this.clock(); return s;
  }
  push(s, body) {
    if (!Number.isSafeInteger(body.seq) || body.seq < 1) throw problem(400, 'Voice sequence must be a positive integer.');
    if (body.seq <= s.seq) return {ok:true, duplicate:true, seq:s.seq};
    const value = body.pcm;
    if (typeof value !== 'string' || value.length > 21336 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
      throw problem(400, 'Invalid or oversized base64 PCM.');
    const b = Buffer.from(value, 'base64');
    if (b.toString('base64') !== value || b.length % FRAME !== 0 || b.length > FRAME * MAX_FRAMES)
      throw problem(400, 'PCM must contain 0-25 complete 640-byte frames.');
    if (body.format !== 'pcm-s16-le' || body.sampleRate !== 16000 || body.channels !== 1)
      throw problem(400, 'Only PCM signed-16 LE, 16000 Hz, mono is supported.');
    const t = this.clock();
    if (t - s.frameWindow >= 1000) { s.frameWindow = t; s.windowFrames = 0; }
    if (s.windowFrames + b.length / FRAME > 75) throw problem(429, 'Voice frame rate exceeded.');
    s.windowFrames += b.length / FRAME; s.seq = body.seq;
    const muted = b.length === 0 || body.muted === true;
    if (muted !== s.muted) { s.muted = muted; this.notify(s.room); }
    if (!muted) for (let i = 0; i < b.length; i += FRAME) {
      const frame = b.subarray(i, i + FRAME);
      this.broadcast(s.room, s.id, s.clientId, frame);
      this.accept(s.room, s.id, s.clientId, frame);
    }
    return {ok:true, seq:s.seq, frames:muted ? 0 : b.length / FRAME};
  }
  accept(room, senderId, senderClientId, frame) {
    if (!Buffer.isBuffer(frame) || frame.length !== FRAME) return;
    for (const s of this.sessions.values()) {
      if (s.room !== room || s.id === senderId || s.clientId === senderClientId) continue;
      let src = s.sources.get(senderId);
      if (!src || this.clock() - src.at > STALE_MS) {
        if (s.sources.size >= 12) s.sources.delete(s.sources.keys().next().value);
        src = {frames:[], at:this.clock()}; s.sources.set(senderId, src);
      }
      src.at = this.clock(); src.frames.push(Buffer.from(frame));
      if (src.frames.length > MAX_FRAMES) src.frames.shift();
    }
  }
  pull(s) {
    const tracks = [];
    for (const [id, src] of s.sources) {
      if (this.clock() - src.at > STALE_MS) { s.sources.delete(id); continue; }
      if (src.frames.length) tracks.push(src.frames.splice(0, 10));
    }
    const frames = Math.max(0, ...tracks.map(t => t.length));
    if (!frames) return {ok:true, wav:'', frames:0};
    const pcm = Buffer.alloc(frames * FRAME);
    for (let f = 0; f < frames; f++) for (let i = 0; i < FRAME; i += 2) {
      const active = tracks.filter(t => t[f]);
      // Average active participants to prevent clipping; self audio is excluded above.
      const value = Math.round(active.reduce((a,t) => a + t[f].readInt16LE(i), 0) / active.length);
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, value)), f * FRAME + i);
    }
    return {ok:true, wav:wav(pcm).toString('base64'), frames, durationMs:frames * 20};
  }
  closeMember(room, id) {
    let changed = false;
    for (const [key,s] of this.sessions) if (s.room === room && s.clientId === id) {
      s.sources.clear(); this.sessions.delete(key); changed = true;
    }
    if (changed) this.notify(room);
  }
  sweep() {
    for (const s of [...this.sessions.values()]) if (this.clock() - s.lastSeen > 6000)
      this.closeMember(s.room, s.clientId);
  }
  clear() { for (const s of this.sessions.values()) s.sources.clear(); this.sessions.clear(); }
}
module.exports = {NativeVoice, wav, FRAME, MAX_FRAMES};
