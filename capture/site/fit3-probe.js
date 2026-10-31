// Galaxy Fit3 SAP protocol subset for a read-mostly diagnostic probe.
//
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 contributors of this probe.
// Derived from (both GPL-3.0; this file is distributed under GPL-3.0-only, see LICENSE and NOTICE.md in the repo/zip root):
//   - GokulArumugam/Fit3Bridge @ f31d8929 web/fit3.js (GPL-3.0): framing, CRC, reassembly,
//     capability handshake, battery parser, firmware string scan.
//   - yuriyurin/Fit3-App @ 1ac39f06 (GPL-3.0-only): Fit3SapCodec.kt, Fit3BatteryCodec.kt,
//     Fit3HealthCodec.kt, Fit3VitalCodec.kt, Fit3HealthLargeDataReceiver.kt (Health service 10).
// Changes: subset only; added an outbound allowlist; heart-rate/step parsers return raw
// samples instead of merged app state. No Samsung code is included.
//
// STATUS: UNVALIDATED by this project on any real band or iPhone.

export const GATT = Object.freeze({
  service: "00001a1a-0000-1000-8000-00805f9b34fb",
  notify: "797ae4e9-2e58-4fe8-b48d-b5c79599fb9b",
  write: "63e30bad-4206-4596-839f-e47cbf7a4b5d",
});

export const SERVICE = Object.freeze({ OOBE: 1, HEALTH: 10, SETTINGS: 11 });
export const SERVICE_NAMES = Object.freeze({
  1: "OOBE", 3: "CALL", 4: "LOCATION", 5: "WEATHER", 6: "FACE", 7: "NOTI", 8: "CALENDAR", 9: "MEDIA",
  10: "HEALTH", 11: "SETTINGS", 15: "WIDGETS", 18: "QUICK_MSG", 19: "QUICK_PANEL", 24: "APPS", 30: "OTA",
});

// Read-only OOBE requests (message ids 1 and 2). InitSettings (3) and UserAgreement (4) are excluded.
export const watchInfoRequest = Object.freeze([0x01, 0x04, 0x02, 0, 0, 0, 0x05, 0, 0x0e]);
export const deviceStatusRequest = Object.freeze([0x02, 0x01, 0x00]);
export const batteryRequest = Object.freeze([0x02]);

export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------- transport
export function crc16(data) {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}
const crcBytes = (d) => { const v = crc16(d); return [v >>> 8, v & 0xff]; };

export const isCapabilityRequest = (d) => d.length === 105 && d[0] === 104 && d[1] === 0x14;
export const isCapabilityResponse = (d) => d.length === 105 && d[0] === 104 && d[1] === 0x15;
export const negotiatedTransportMtu = (r) => (r[0x2c] << 8) | r[0x2d];
export function capabilityResponse(r) {
  if (!isCapabilityRequest(r)) throw new Error("not a capability request");
  const out = Array.from(r); out[1] = 0x15; return out;
}

function encodeBody(body, mtu) {
  if (mtu < 256) {
    if (body.length > 255) throw new Error("body too long for short prefix");
    return [body.length, body.length, ...body, ...crcBytes(body)];
  }
  const len = [body.length >>> 8, body.length & 0xff];
  return [...len, ...crcBytes(len), ...body, ...crcBytes(body)];
}

/** One SAP message → one or more frames. `maxFrame` additionally caps frame size to the BLE write size. */
export function encodeMessage(service, message, mtu, maxFrame = mtu) {
  if (!(service >= 1 && service <= 31) || !message.length) throw new Error("bad service/message");
  if (!(mtu >= 15 && mtu <= 500)) throw new Error("transport MTU out of range");
  const limit = Math.min(mtu, maxFrame);
  const prefix = mtu < 256 ? 2 : 4;
  if (prefix + 4 + message.length + 2 <= limit) return [encodeBody([0, 0x40, service, service, ...message], mtu)];
  const firstCap = limit - prefix - 2 - 4, contCap = limit - prefix - 2 - 2;
  if (firstCap <= 0 || contCap <= 0) throw new Error("frame limit too small");
  const frames = [];
  let off = Math.min(firstCap, message.length), seq = 0;
  frames.push(encodeBody([2, seq, service, service, ...message.slice(0, off)], mtu));
  seq++;
  while (off < message.length) {
    if (seq > 15) throw new Error("too many fragments");
    const take = Math.min(contCap, message.length - off);
    const kind = off + take >= message.length ? 3 : 2;
    frames.push(encodeBody([kind << 1, seq, ...message.slice(off, off + take)], mtu));
    off += take; seq++;
  }
  return frames;
}

export function decodeFrame(f) {
  if (f.length < 8) throw new Error("short frame");
  const shortOk = f[0] === f[1] && f[0] + 4 === f.length;
  const longLen = (f[0] << 8) | f[1];
  const lc = crcBytes([f[0], f[1]]);
  const longOk = f.length >= 10 && longLen + 6 === f.length && f[2] === lc[0] && f[3] === lc[1];
  if (!shortOk && !longOk) throw new Error("bad prefix");
  const body = f.slice(shortOk ? 2 : 4, f.length - 2);
  const c = crcBytes(body);
  if (f[f.length - 2] !== c[0] || f[f.length - 1] !== c[1]) throw new Error("bad crc");
  if (body[0] >>> 6) throw new Error("control frame");
  const kind = (body[0] >>> 1) & 3, first = kind === 0 || kind === 1;
  return {
    kind, sequence: body[1] & 0x0f, stream: body[1] >>> 5,
    service: first ? body[2] : null, payload: Array.from(body.slice(first ? 4 : 2)),
  };
}

/** One message at a time, ≤ 4096 bytes, ≤ 16 fragments (docs/PROTOCOL.md). */
export class Reassembler {
  constructor() { this.reset(); }
  reset() { this.service = null; this.stream = -1; this.next = 0; this.data = []; }
  push(fr) {
    if (fr.kind === 0) { this.reset(); return { service: fr.service, message: fr.payload }; }
    if (fr.kind === 1) {
      this.reset();
      if (fr.sequence !== 0) return null;
      Object.assign(this, { service: fr.service, stream: fr.stream, next: 1, data: [...fr.payload] });
      return null;
    }
    if (this.service == null || fr.stream !== this.stream || fr.sequence !== this.next ||
        this.data.length + fr.payload.length > 4096) { this.reset(); return null; }
    this.data.push(...fr.payload); this.next++;
    if (fr.kind !== 3) return null;
    const out = { service: this.service, message: this.data }; this.reset(); return out;
  }
}

// ---------------------------------------------------------------- OOBE / settings (read-only)
export const oobeResponseId = (m) => (m.length && m[0] >= 0x41 && m[0] <= 0x44 ? m[0] & 0x3f : null);

export function findSoftwareVersion(m) {
  const s = String.fromCharCode(...m.map((b) => (b < 128 ? b : 46)));
  const r = s.match(/R390[A-Z0-9]{7,12}/);
  return r ? r[0] : null;
}

/** Fit3BatteryCodec.parse: response id 2, params 5=level(0-100), 6=charging(0-3), with resync fallback. */
export function parseBattery(m) {
  if (!m.length || (m[0] & 0x40) === 0 || (m[0] & 0x3f) !== 2) return null;
  let level = null, charging = null;
  for (let i = 1; i + 1 < m.length; i += 2) {
    if (m[i] === 5 && m[i + 1] <= 100) level = m[i + 1];
    if (m[i] === 6 && m[i + 1] <= 3) charging = m[i + 1];
  }
  if (level == null || charging == null)
    for (let p = 1; p < m.length - 1; p++) {
      if (m[p] === 5 && m[p + 1] <= 100) level = m[p + 1];
      if (m[p] === 6 && m[p + 1] <= 3) charging = m[p + 1];
    }
  return level == null || charging == null ? null : { percent: level, charging: charging !== 0 };
}

// ---------------------------------------------------------------- Health (service 10), from Fit3HealthCodec.kt
export const HEALTH_CMD = Object.freeze({
  CHECK_STATUS: 1, SYNC_DATA: 2, REQUEST_DATA: 3, WEARABLE_MSG: 4, PEDOMETER_BACK_SYNC: 7,
  WEARABLE_REQUEST_CAPABILITY: 32, MOBILE_REQUEST_CAPABILITY: 33, GM_REQUEST_CAPABILITY: 34,
  GM_CAPABILITY_NOTI: 35, PLUGIN_HEALTH_CAPABILITY_REQUEST: 52, LARGE_DATA_ACK: 62, LARGE_DATA_CHUNK: 63,
});
const HEALTH_NAMES = {
  1: "CHECK_STATUS", 2: "SYNC_DATA", 3: "REQUEST_DATA", 4: "WEARABLE_MSG", 6: "NETWORK_IMAGE",
  7: "PEDOMETER_BACK_SYNC", 8: "CYCLE_WMSG", 9: "SOUND_RELAY", 32: "WEARABLE_CAPABILITY",
  33: "MOBILE_CAPABILITY", 34: "GM_REQUEST_CAPABILITY", 35: "GM_CAPABILITY_NOTI", 52: "HOST_CAPABILITY",
};
export const DATA_TYPE = Object.freeze({ PEDO_STEP_COUNT: 7, HEART_RATE: 10, SLEEP: 16, STRESS: 19, SPO2: 112 });

const GM_STATUS = 0xd0, GM_RESULT = 0xd1, GM_HOST_VER = 0xd2, GM_HOST_TARGET_VER = 0xd3;
const GM_SEQ = 0xe0, GM_PROTO = 0xe1;
const EMULATED_SHEALTH_VERSION = 7_006_011, FIT3_MIN_SHEALTH_VERSION = 6_040_000;
const HEALTH_EPOCH_MS = 631_152_000_000; // 1990-01-01T00:00:00Z

const header = (format, type, id) => (format << 7) | (type << 6) | id;
const parseHeader = (m) => (m.length ? { format: (m[0] >>> 7) & 1, type: (m[0] >>> 6) & 1, id: m[0] & 0x3f } : null);
const le16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const readLe16 = (b, o) => (o >= 0 && o + 2 <= b.length ? b[o] | (b[o + 1] << 8) : null);
const readLe32u = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const readLe32s = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const f32 = (b, o) => new DataView(Uint8Array.from(b.slice(o, o + 4)).buffer).getFloat32(0, true);
const shortParam = (id, v) => [id, ...le16(v)];
const intParam = (id, v) => [id, ...le32(v)];
function stringParam(id, s) {
  const raw = Array.from(new TextEncoder().encode(s)).slice(0, 255);
  return [id, raw.length, ...raw];
}

export function describeHealth(m) {
  const h = parseHeader(m); if (!h) return null;
  const dir = h.type === 0 ? "REQ" : "RSP";
  const name = HEALTH_NAMES[h.id];
  if (!name) return `HEALTH id=${h.id} ${dir} fmt=${h.format}`;
  if (h.id === HEALTH_CMD.GM_REQUEST_CAPABILITY) {
    const gm = parseGmRequest(m);
    if (gm) return `${name} ${dir} seq=${gm.sequence} proto=${gm.protocolVersion}`;
  }
  return `${name} ${dir}`;
}

/** Band → phone GM capability request: A2 <count> (E0 seq16 | E1 proto16 | D0/D1 b | D2/D3 i32)… */
export function parseGmRequest(m) {
  const h = parseHeader(m);
  if (!h || h.id !== HEALTH_CMD.GM_REQUEST_CAPABILITY || h.format !== 1 || h.type !== 0 || m.length < 2) return null;
  let i = 2, seq = null, proto = null;
  for (let n = 0; n < m[1] && i < m.length; n++) {
    const id = m[i++];
    if (id === GM_SEQ) { seq = readLe16(m, i); i += 2; }
    else if (id === GM_PROTO) { proto = readLe16(m, i); i += 2; }
    else if (id === GM_STATUS || id === GM_RESULT) i += 1;
    else if (id === GM_HOST_VER || id === GM_HOST_TARGET_VER) i += 4;
    else break; // unknown param width: stop (fail closed), as upstream
  }
  return seq == null || proto == null ? null : { sequence: seq, protocolVersion: proto };
}

export function gmCapabilityResponse({ sequence, protocolVersion }) {
  return [header(1, 1, HEALTH_CMD.GM_REQUEST_CAPABILITY), 6,
    GM_STATUS, 2 /* S Health installed */, GM_RESULT, 0 /* success */,
    ...intParam(GM_HOST_VER, EMULATED_SHEALTH_VERSION), ...intParam(GM_HOST_TARGET_VER, FIT3_MIN_SHEALTH_VERSION),
    ...shortParam(GM_SEQ, sequence), ...shortParam(GM_PROTO, protocolVersion)];
}

/** E0 sequence of a band capability request (offset 2, then defensive scan as upstream). */
export function parseCapabilitySequence(m) {
  if (m.length >= 5 && m[2] === GM_SEQ) return readLe16(m, 3);
  for (let i = 2; i < m.length - 2; i++) if (m[i] === GM_SEQ) return readLe16(m, i + 1);
  return null;
}

const json = (pairs) => "{" + pairs.map(([k, v]) => `"${k}":${v}`).join(",") + "}";
const q = (s) => JSON.stringify(s);

/** Fit3-App wearableCapabilityResponse(): emulated Samsung Health 7.0.6.011 host, protocol 4.51. */
export function wearableCapabilityResponse(sequence) {
  const params = [
    shortParam(GM_SEQ, sequence),
    [0xa1, 4, 0x51],
    intParam(0xa2, EMULATED_SHEALTH_VERSION),
    stringParam(0xc0, "com.samsung.android.app.shealth.RESPONSE_CAPABILITY"),
    stringParam(0xc1, "shealth"),
    stringParam(0xc2, "wearable"),
    stringParam(0xae, json([["pedometer", "4"]])),
    stringParam(0xaf, json([["wearable_messaging", "true"], ["compression", "true"], ["wm_chunk_size", "10000"],
      ["sync_duration", "30"], ["blob_compression", "true"]])),
    stringParam(0xb1, json([["common_sync", q("com.samsung.android.app.shealth.wearable.syncmanager")]])),
    stringParam(0xb3, json([
      ["pedometer_sync", json([["support_wearable_all_step", "true"]])],
      ["goal_support", json([["pedometer", "1"], ["floor", "1"], ["water", "0"]])],
      ["daily_activity", json([["support", "false"]])],
      ["dashboard_config_sync", json([["version", "1000"], ["is_support", "true"]])]])),
    stringParam(0xac, json([["os", q("android")], ["os_version", q("16")], ["country_iso", q("")], ["one_ui_version", "-1"]])),
    stringParam(0xc3, json([["message_version", "5.18"], ["message_support", "true"], ["message_compression", "true"],
      ["message_compression_format", q("gzip")], ["message_size", "10000"]])),
    stringParam(0xad, json([["support", "false"], ["target_list", q("settings.band.manage_exercises")]])),
  ];
  return [header(1, 1, HEALTH_CMD.WEARABLE_REQUEST_CAPABILITY), params.length, ...params.flat()];
}

/** One-byte host capability probe used by the official plugin (Fit3-App mobileCapabilityRequest). */
export const hostCapabilityProbe = Object.freeze([0x34]);

/** Fit3-App requestData(): 31-byte REQUEST_DATA with zero last-sync cursor (asks for a full exchange). */
export function requestData(sequence, nowMs) {
  if (!(sequence >= 1 && sequence <= 0xffff)) throw new Error("sequence out of range");
  const end = Math.min(Math.max(Math.floor(nowMs / 1000) - 631_152_000, 0), 0xffffffff);
  return [3, ...shortParam(GM_SEQ, sequence), 5, 25, 1, 0, 2, 0, 0, 3, 4, 51,
    ...intParam(4, 0), ...intParam(5, 0), ...intParam(6, end), 7, 1];
}

export function syncDataSuccessResponse(req) {
  if (req.length < 5 || req[2] !== GM_SEQ) return null;
  return [0x42, 2, GM_SEQ, req[3], req[4], 4, 2, 1, 1];
}
export function requestDataEmptySuccessResponse(req) {
  if (req.length < 4 || req[1] !== GM_SEQ) return null;
  return [0x43, GM_SEQ, req[2], req[3], 4, 2, 1, 1];
}

/** Fit3HealthLargeDataReceiver: id-63 chunks [63, flag(0 first/1 mid/2 last), n LE32, data…]; ack id 62. */
export class HealthLargeData {
  constructor() { this.reset(); }
  reset() { this.chunks = []; this.size = 0; this.next = 0; }
  accept(m) {
    if (!m.length || (m[0] & 0x3f) !== HEALTH_CMD.LARGE_DATA_CHUNK) return null;
    if (m.length < 6) { this.reset(); return { payload: null, reply: ack(0, false) }; }
    const flag = m[1] & 3, n = readLe32u(m, 2);
    if (flag === 0 && n === 0) this.reset();
    if (flag > 2 || (flag === 0) !== (n === 0) || n !== this.next || this.next >= 256 ||
        this.size + m.length - 6 > 1024 * 1024) {
      this.reset(); return { payload: null, reply: ack(Math.min(n, 0x7fffffff), false) };
    }
    this.chunks.push(...m.slice(6)); this.size += m.length - 6; this.next++;
    if (flag !== 2) return { payload: null, reply: null };
    const out = { payload: this.chunks, reply: ack(this.next, true) };
    this.reset(); return out;
  }
}
const ack = (count, ok) => [HEALTH_CMD.LARGE_DATA_ACK, ok ? 9 : 8, ...le32(count)];

const healthTime = (b, o) => (readLe32u(b, o) * 1000) + HEALTH_EPOCH_MS;

/** SYNC_DATA type 7 PedometerStepCount intervals (Fit3HealthCodec.parsePedometerIntervals). Fails closed. */
export function parsePedometerIntervals(m) {
  if (m.length < 8 || m[0] !== 0x82 || m[2] !== GM_SEQ || m[5] !== DATA_TYPE.PEDO_STEP_COUNT) return null;
  const out = [];
  let i = 6;
  const FIELDS = [5, 1, 2, 3, 16, 17, 18, 19, 20, 21, 22, 23];
  for (let r = 0; r < 128; r++) {
    if (i >= m.length) return out.length ? out : null;
    const more = m[i++];
    if (more > 1) return null;
    const rec = { startMs: null, steps: null, walkSteps: 0, runSteps: 0, distanceM: 0, kcal: 0, durationMs: 0 };
    for (const field of FIELDS) {
      if (i >= m.length || m[i++] !== field) return null;
      const width = field === 23 ? 1 : 4;
      if (i + width > m.length) return null;
      if (width === 4) {
        const raw = readLe32s(m, i);
        if (field === 1) rec.startMs = healthTime(m, i);
        else if (field === 16) rec.steps = raw >= 0 && raw <= 100_000 ? raw : null;
        else if (field === 17) rec.distanceM = f32(m, i);
        else if (field === 19) rec.kcal = f32(m, i);
        else if (field === 20) rec.runSteps = raw;
        else if (field === 21) rec.walkSteps = raw;
        else if (field === 22) rec.durationMs = raw;
      }
      i += width;
    }
    if (rec.startMs == null || rec.steps == null) return null;
    if (rec.walkSteps < 0 || rec.walkSteps > rec.steps || rec.runSteps < 0 || rec.runSteps > rec.steps ||
        !Number.isFinite(rec.distanceM) || rec.distanceM < 0 || rec.distanceM > 100_000 ||
        !Number.isFinite(rec.kcal) || rec.kcal < 0 || rec.kcal > 10_000 ||
        rec.durationMs < 0 || rec.durationMs > 86_400_000) return null;
    out.push(rec);
    if (more === 0) return out;
  }
  return null;
}

/** Fit3VitalCodec field widths for type 10 (heart rate). 0 = unknown → reject; -1 = LE32-length blob. */
function hrFieldWidth(id) {
  if ([1, 2, 3, 5, 151, 153].includes(id)) return 4;
  if ([32, 33, 34, 35].includes(id)) return 1;
  if (id === 36) return -1;
  if (id === 37) return 2;
  return 0;
}

/**
 * SYNC_DATA type 10: 82 ? E0 seq16 0A (hasMore len32 body)… Strict; null on ambiguity.
 * Independent protocol-fact implementation (not a Java port): tag 0x24 contains a LE32 BYTE
 * length <=300, four unsigned bytes per minute. START_TIME uses the Samsung 1990 epoch.
 * Evidence: HR_BINNING_REVIEW.md / Gadgetbridge Fit3HealthHeartRateRecord.java (AGPL source
 * reviewed for wire facts only). Existing GPL notices and scalar/range diagnostics retained.
 * Empty/no BINNING => spot; nonempty BINNING suppresses scalar average even if every HR is zero.
 * Positive out-of-range values remain diagnostic samples, marked untrusted by ProbeSession.
 */
export function parseHeartRate(m) {
  if (!Array.isArray(m) && !(m instanceof Uint8Array)) return null;
  for (const byte of m) if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
  if (m.length < 12 || m[0] !== 0x82 || m[2] !== GM_SEQ || m[5] !== DATA_TYPE.HEART_RATE) return null;
  let off = 6;
  const out = [];
  for (let r = 0; r < 128; r++) {
    if (off + 5 > m.length) return null;
    const more = m[off++];
    if (more > 1) return null;
    const len = readLe32s(m, off); off += 4;
    if (len <= 0 || len > 65_536 || off + len > m.length) return null;
    const end = off + len, fields = new Map();
    let o = off;
    while (o < end) {
      const id = m[o++], w = hrFieldWidth(id);
      if (w === 0 || fields.has(id)) return null;
      if (w < 0) {
        if (o + 4 > end) return null;
        const bl = readLe32s(m, o); o += 4;
        if (bl < 0 || bl > 300 || bl % 4 !== 0 || o + bl > end) return null;
        fields.set(id, m.slice(o, o + bl)); o += bl;
      } else {
        if (o + w > end) return null;
        fields.set(id, m.slice(o, o + w)); o += w;
      }
    }
    if (!fields.has(1)) return null;
    const t = (id) => (fields.has(id) ? healthTime(fields.get(id), 0) : null);
    const b = (id) => (fields.has(id) ? fields.get(id)[0] : null);
    const binBytes = fields.get(36);
    if (binBytes?.length) {
      for (let i = 0; i < binBytes.length; i += 4) {
        if (binBytes[i + 1] > 0) out.push({ startMs: t(1), endMs: t(2),
          measuredAt: t(1) + binBytes[i] * 60_000, granularity: "minute", sampleType: "heart-rate",
          bpm: binBytes[i + 1], minBpm: binBytes[i + 2], maxBpm: binBytes[i + 3] });
      }
    } else if (b(32) > 0) out.push({ startMs: t(1), endMs: t(2), measuredAt: t(1), granularity: "spot", sampleType: "heart-rate",
      bpm: b(32), minBpm: b(33), maxBpm: b(34) });
    off = end;
    if (more === 0) {
      // Existing Fit3-App synthetic layout includes an empty DeviceInfo footer (05 00).
      // Accept that exact known suffix only; mixed/trailing records remain unsupported.
      const emptyDeviceInfo = m.length === off + 2 && m[off] === 5 && m[off + 1] === 0;
      return off === m.length || emptyDeviceInfo ? out : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- outbound allowlist
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Every phone → band SAP message must pass here. Returns a label or throws.
 * Allowed: read-only requests (watch info, device status, battery), Health host probe and
 * REQUEST_DATA, and the documented Health replies/acks. Everything else (clock/time, OOBE
 * completion, language, notifications, calls, watch faces, OTA/firmware, goals, back-sync) is refused.
 */
export function classifyOutbound(service, m) {
  const deny = () => { throw new Error(`outbound not allowed: service ${service} ${hex(m)}`); };
  if (service === SERVICE.OOBE) {
    if (same(m, watchInfoRequest)) return "oobe-watch-info (read-only)";
    if (same(m, deviceStatusRequest)) return "oobe-device-status (read-only)";
    return deny();
  }
  if (service === SERVICE.SETTINGS) return same(m, batteryRequest) ? "battery-request (read-only)" : deny();
  if (service === SERVICE.HEALTH) {
    if (same(m, hostCapabilityProbe)) return "health-host-capability-probe";
    if (m.length === 31 && m[0] === 3 && m[1] === GM_SEQ && same(m.slice(4, 14), [5, 25, 1, 0, 2, 0, 0, 3, 4, 51]))
      return "health-request-data";
    if (m[0] === 0xe2 && m.length === 22 && m[1] === 6) return "health-gm-capability-response";
    if (m[0] === 0xe0 && m[1] === 13 && m[2] === GM_SEQ) return "health-wearable-capability-response";
    if (m.length === 9 && m[0] === 0x42 && m[1] === 2 && m[2] === GM_SEQ && same(m.slice(5), [4, 2, 1, 1]))
      return "health-sync-data-ack";
    if (m.length === 8 && m[0] === 0x43 && m[1] === GM_SEQ && same(m.slice(4), [4, 2, 1, 1]))
      return "health-request-data-empty-success";
    if (m.length === 6 && m[0] === HEALTH_CMD.LARGE_DATA_ACK && (m[1] === 8 || m[1] === 9)) return "health-large-data-ack";
    if (m.length === 1 && (m[0] === 0x41 || m[0] === 0x44)) return "health-fixed-response";
    return deny();
  }
  return deny();
}
