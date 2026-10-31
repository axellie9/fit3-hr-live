// PASSIVE history-r1 diagnostic: raw RAM capture, no outbound transport retained.
// Legacy constructor write/options remain compatibility inputs, never write authority.
//
// SPDX-License-Identifier: GPL-3.0-only
// Flow logic follows GokulArumugam/Fit3Bridge web/index.html (GPL-3.0) and
// yuriyurin/Fit3-App ble/Fit3BleClient.kt health handling (GPL-3.0-only); see NOTICE.md in the repo/zip root.
// STATUS: UNVALIDATED by this project on any real band or iPhone.
import * as P from "./fit3-probe.js";

const HR_PLAUSIBLE = [25, 250];          // Fit3-App range filter
const MAX_AGE_MS = 24 * 60 * 60_000;     // Fit3-App: vitals older than 24 h ignored for "current" value
const MAX_FUTURE_MS = 5 * 60_000;

export class ProbeSession {
  constructor({ write, log = () => {}, now = () => Date.now(), maxFrame = 180, monotonicNow = () => performance.now(), limits = {} } = {}) {
    this._active = true;
    // Intentionally do not retain the injected transport writer. This revision is PASSIVE.
    this._write = async (bytes) => this._tx(null, bytes, "raw-write");
    this._logSink = log;
    this._now = now;
    this.maxFrame = maxFrame;
    this.options = { armHandshake: false, armHealth: false, ackSync: false };
    this._asm = new P.Reassembler();
    this._large = new P.HealthLargeData();
    this._seq = 1 + (Math.floor(now() / 1000) % 60000);
    this._pendingCapability = null;
    this._lines = [];
    this._journal = [];
    this._captureSequence = 0;
    this._capturedBytes = 0;
    this._monotonicNow = monotonicNow;
    this._startedMono = monotonicNow();
    this._startedAt = now();
    this._stopped = null;
    this._ignoredAfterStop = 0;
    const caps = { maxRecords: 4096, maxBytes: 1048576, maxDurationMs: 60000 };
    this.limits = Object.freeze({ ...caps, ...limits });
    for (const [key, value] of Object.entries(this.limits))
      if (!(key in caps) || !Number.isSafeInteger(value) || value < 1 || value > caps[key]) throw new Error(`invalid capture limit: ${key}`);
    this._timer = setTimeout(() => this._stop("time-limit"), this.limits.maxDurationMs);
    this._timer.unref?.();
    this._provenance = Object.freeze({ source: "parallel/web-probe (see COPY_ALLOWLIST.json)", parserVersion: "history-r1-passive-v1", fixtureStatus: "runtime-input; not proof of device provenance" });
    this._hrSamples = new Map(); // Per-session; device/type/measuredAt/granularity identity.
    this.device = null;
    this.state = {
      handshake: "waiting", transportMtu: null, firmware: null, battery: null,
      health: { gm: null, wearableCapabilityAnswered: false, stepIntervals: [], heartRate: [], conflicts: [], otherTypes: [] },
    };
  }

  invalidate() {
    this._stop("session-invalidated");
    this.options = { armHandshake: false, armHealth: false, ackSync: false };
    this._pendingCapability = null;
  }
  _requireActive() { if (!this._active) throw new Error("session invalidated"); }

  _stop(reason, rejected = null) {
    if (this._stopped) return;
    this._stopped = { reason, timestamp: this._now(), rejected };
    this._active = false;
    clearTimeout(this._timer);
    this.options = { armHandshake: false, armHealth: false, ackSync: false };
  }

  _reserve(records, bytes, direction, action = null) {
    if (!this._active) { this._ignoredAfterStop++; return false; }
    const rejected = { direction, action, byteLength: bytes };
    let reason = null;
    if (this._monotonicNow() - this._startedMono >= this.limits.maxDurationMs) reason = "time-limit";
    else if (this._journal.length + records > this.limits.maxRecords) reason = "record-limit";
    else if (this._capturedBytes + bytes > this.limits.maxBytes) reason = "byte-limit";
    if (reason) { this._stop(reason, rejected); return false; }
    return true;
  }

  _record(entry) {
    this._capturedBytes += entry.bytes?.length || 0;
    this._journal.push({ sequence: ++this._captureSequence, timestamp: this._now(), elapsedMs: this._monotonicNow() - this._startedMono, provenance: this._provenance, ...entry });
  }

  setDevice(d) { this.device = d ? { name: d.name || "", id: d.id || "" } : null; }

  log(kind, text, extra = {}) {
    if (!this._active) return;
    const e = { t: this._now(), kind, text, ...extra };
    this._lines.push(e);
    if (this._lines.length >= 5000) this._stop("log-record-limit");
    this._logSink(e);
    return e;
  }

  // ------------------------------------------------------------ inbound
  async onNotify(data) {
    if (!(Array.isArray(data) || data instanceof Uint8Array)) {
      this._stop("invalid-rx-input", { direction: "RX", byteLength: null }); return;
    }
    if (!this._reserve(1, data.length, "RX")) return;
    for (const b of data) if (!Number.isInteger(b) || b < 0 || b > 255) {
      this._stop("invalid-rx-input", { direction: "RX", byteLength: data.length }); return;
    }
    data = Array.from(data);
    this._record({ direction: "RX", status: "received", receivedAt: this._now(), channel: P.GATT.notify, bytes: data.slice() });
    if (P.isCapabilityRequest(data)) return this._onCapability(data);
    let fr;
    try { fr = P.decodeFrame(data); } catch (e) {
      this.log("rx-raw", `undecodable notification (${e.message})`, { hex: P.hex(data) }); return;
    }
    const m = this._asm.push(fr);
    if (!m) return;
    const name = P.SERVICE_NAMES[m.service] || `svc${m.service}`;
    this.log("rx", `${name} ${m.service === P.SERVICE.HEALTH ? P.describeHealth(m.message) : ""}`.trim(),
      { service: m.service, hex: P.hex(m.message) });
    if (m.service === P.SERVICE.OOBE) this._onOobe(m.message);
    else if (m.service === P.SERVICE.SETTINGS) this._onSettings(m.message);
    else if (m.service === P.SERVICE.HEALTH) await this._onHealth(m.message);
    else this.log("info", `${name} message ignored (out of probe scope, never answered)`);
  }

  async _onCapability(data) {
    this.state.transportMtu = P.negotiatedTransportMtu(data);
    this._pendingCapability = data;
    this.log("rx", `SAP capability request (105 B), transport MTU ${this.state.transportMtu}`, { hex: P.hex(data) });
    this.state.handshake = "received-unanswered";
    this.log("info", "PASSIVE: handshake NOT answered; payload/identity approval required");
  }

  /** Legacy action retained only as a refused/ledgered attempt; no reply is constructed. */
  async replyHandshakeNow() {
    return this._tx(null, [], "replyHandshakeNow");
  }

  _onOobe(m) {
    const v = P.findSoftwareVersion(m);
    if (v) { this.state.firmware = v; this.log("milestone", `firmware string decoded: ${v}`); }
    const id = P.oobeResponseId(m);
    if (id === 2) this.log("info", "device status response received (raw bytes in log)");
  }

  _onSettings(m) {
    const b = P.parseBattery(m);
    if (!b) return;
    this.state.battery = { ...b, at: this._now(), source: "SETTINGS(11) battery response 0x42" };
    this.log("milestone", `M4 candidate: battery ${b.percent}%${b.charging ? " (charging)" : ""}`);
  }

  async _onHealth(msg) {
    const large = this._large.accept(msg);
    if (large) {
      this.log("info", "Historical large-data ACK locked OFF: no durable raw-packet commit; memory log/export is not persistence");
      if (!large.payload) return;
      this.log("rx", `HEALTH large-data reassembled: ${P.describeHealth(large.payload)}`, { hex: P.hex(large.payload) });
      msg = large.payload;
    }
    const h = msg[0] & 0x3f, isRequest = ((msg[0] >>> 6) & 1) === 0;
    const C = P.HEALTH_CMD;
    // Legacy caller flags are not authority to write. Only SYNC decoding is retained.
    if (h !== C.SYNC_DATA) {
      this.log("info", "PASSIVE: Health request observed, never answered (including REQUEST_DATA 0x43)");
      return;
    }
    if (h === C.SYNC_DATA) return this._onSync(msg, isRequest);
  }

  async _onSync(msg, isRequest) {
    const now = this._now();
    let decoded = false;
    const steps = P.parsePedometerIntervals(msg);
    if (steps) {
      decoded = true;
      for (const s of steps) {
        const list = this.state.health.stepIntervals;
        const rec = { ...s, unit: "steps", receivedAt: now, source: "SYNC_DATA type 7 (PedometerStepCount interval)" };
        const i = list.findIndex((x) => x.startMs === s.startMs);
        if (i >= 0) list[i] = rec; else list.push(rec);
      }
      this.log("milestone", `M5 candidate: ${steps.length} step interval(s), ${steps.reduce((a, s) => a + s.steps, 0)} steps`);
    }
    const hr = P.parseHeartRate(msg);
    if (hr) {
      decoded = true;
      for (const s of hr) {
        const at = s.measuredAt;
        const plausible = s.bpm != null && s.bpm >= HR_PLAUSIBLE[0] && s.bpm <= HR_PLAUSIBLE[1] &&
          at != null && at >= now - MAX_AGE_MS && at <= now + MAX_FUTURE_MS;
        const key = JSON.stringify([this.device?.id || this.device?.name || "", s.sampleType, s.measuredAt, s.granularity]);
        const value = JSON.stringify([s.bpm, s.minBpm, s.maxBpm]);
        const seen = this._hrSamples.get(key);
        if (seen?.has(value)) {
          const previous = seen.get(value);
          previous.replayCount++;
          previous.lastReceivedAt = now;
          this.log("replay", `Identical heart-rate replay retained in raw log; ${s.granularity} ${s.measuredAt}`);
          continue;
        }
        const rec = { ...s, unit: "bpm", plausible, receivedAt: now, lastReceivedAt: now, replayCount: 0,
          source: "SYNC_DATA type 10 (heart rate record)" };
        const variants = seen || new Map();
        variants.set(value, rec); this._hrSamples.set(key, variants);
        if (seen) {
          for (const v of variants.values()) { v.conflict = true; v.plausible = false; }
          let conflict = this.state.health.conflicts.find((c) => c.key === key);
          if (!conflict) {
            conflict = { key, sampleType: s.sampleType, measuredAt: s.measuredAt, granularity: s.granularity, values: [] };
            this.state.health.conflicts.push(conflict);
          }
          conflict.values = [...variants.values()];
          this.log("conflict", `CONFLICT heart rate ${s.granularity} ${s.measuredAt}: ${conflict.values.map((v) => `${v.bpm} bpm (min ${v.minBpm}, max ${v.maxBpm})`).join(" vs ")}; not trusted`);
          continue;
        }
        this.state.health.heartRate.push(rec);
        this.log("milestone", `M5 candidate: heart rate ${s.bpm} bpm${plausible ? "" : " (IMPLAUSIBLE/out of window – not trusted)"}`);
      }
    }
    if (!decoded && msg.length > 5) {
      this.state.health.otherTypes.push({ type: msg[5], receivedAt: now });
      this.log("info", `SYNC_DATA data type ${msg[5]} not decoded by this probe (raw bytes kept in log)`);
    }
    if (!isRequest) return;
    this.log("info", "SYNC_DATA ACK locked OFF: no durable raw-packet commit; band may resend; history delivery unknown");
  }

  // ------------------------------------------------------------ explicit user requests
  _requireReady() {
    if (this.state.handshake !== "answered") throw new Error("SAP handshake not answered yet");
    if (!this.state.transportMtu) throw new Error("transport MTU unknown");
  }
  async requestBattery() { return this._tx(P.SERVICE.SETTINGS, P.batteryRequest); }
  async requestWatchInfo() { return this._tx(P.SERVICE.OOBE, P.watchInfoRequest); }
  async requestDeviceStatus() { return this._tx(P.SERVICE.OOBE, P.deviceStatusRequest); }
  async healthHostProbe() {
    await this._tx(P.SERVICE.HEALTH, P.hostCapabilityProbe);
  }
  async healthRequestData() {
    await this._tx(P.SERVICE.HEALTH, [], "healthRequestData (payload not constructed)");
  }

  async _tx(service, msg, action = "protocol-write") {
    const reason = "PASSIVE: all TX/history ACK forbidden; exact payload approval required";
    if (this._reserve(2, msg.length, "TX", action)) {
      const attemptId = this._captureSequence + 1;
      this._record({ direction: "TX", status: "attempted", channel: P.GATT.write, service, action, attemptId, bytes: Array.from(msg) });
      this._record({ direction: "TX", status: "refused", channel: P.GATT.write, service, action, attemptId, reason });
    }
    throw new Error("PASSIVE: all TX/history ACK forbidden; exact payload approval required");
  }

  // Explicit caller action only. Returns RAM data, never writes files/storage/network.
  exportCapture() {
    if (this._active && this._monotonicNow() - this._startedMono >= this.limits.maxDurationMs) this._stop("time-limit");
    return JSON.parse(JSON.stringify({ schema: "fit3-history-r1-passive-v1", mode: "PASSIVE", privacy: "RAW HEALTH BYTES: explicit local export only; not anonymized; never upload", startedAt: this._startedAt, limits: this.limits, stopped: this._stopped, coverageComplete: false, ignoredAfterStop: this._ignoredAfterStop, capturedBytes: this._capturedBytes, sentCount: 0, records: this._journal }));
  }

  // ------------------------------------------------------------ local log export
  exportLog({ redact = true } = {}) {
    const red = (s) => {
      if (!redact || !this.device) return s;
      let out = s;
      for (const v of [this.device.name, this.device.id]) if (v) out = out.split(v).join("[REDACTED]");
      return out;
    };
    const head = [
      "# Fit3 history-r1 PASSIVE local interpretation log (NOT the raw-fragment journal)",
      "# STATUS: diagnostic probe, UNVALIDATED by its authors on a real band/iPhone.",
      "# PRIVACY: this file may contain raw health bytes (steps / heart rate), firmware string and",
      "#   timestamps. It is generated locally and never uploaded by the page. Share deliberately.",
      `# redaction of device name/id: ${redact ? "ON" : "OFF"}`,
      `# device: ${this.device ? red(`${this.device.name} / ${this.device.id}`) : "(none)"}`,
      `# options: ${JSON.stringify(this.options)}`,
      `# capture stop: ${JSON.stringify(this._stopped)}; raw bytes require explicit exportCapture()`,
      `# state: ${red(JSON.stringify(this.state))}`,
      "",
    ];
    const body = this._lines.map((e) => red(`${new Date(e.t).toISOString()} ${e.kind.padEnd(9)} ${e.text}${e.hex ? " | " + e.hex : ""}`));
    return head.concat(body).join("\n") + "\n";
  }
}
