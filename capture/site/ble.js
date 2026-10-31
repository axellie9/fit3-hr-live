// Thin Web Bluetooth driver for the Fit3 web probe (Bluefy on iPhone, or Chromium on desktop).
// Each function is one explicit user step; nothing here writes SAP data on its own.
//
// SPDX-License-Identifier: GPL-3.0-only
// Connect sequence (full 128-bit service UUID, per-step retries) follows
// GokulArumugam/Fit3Bridge web/index.html (GPL-3.0); see NOTICE.md in the repo/zip root.
// STATUS: UNVALIDATED by this project on any real band or iPhone. Bluefy's exact API surface is
// not documented first-party, so write methods are feature-detected.
import { GATT } from "./fit3-probe.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function describeError(e) {
  if (e == null) return "null";
  if (typeof e !== "object") return `${typeof e} ${String(e)}`;
  const parts = [];
  if (e.name) parts.push(e.name);
  if (e.message) parts.push(e.message);
  if (e.code !== undefined) parts.push("code " + e.code);
  return parts.length ? parts.join(" | ") : String(e);
}

async function step(name, fn, log) {
  log(`→ ${name}`);
  try { const r = await fn(); log(`✓ ${name}`); return r; }
  catch (e) { log(`✗ ${name}: ${describeError(e)}`); e.step = name; throw e; }
}

async function withRetry(name, fn, { log, attempts = 3, retryDelayMs = 2000 }) {
  for (let i = 1; ; i++) {
    try { return await step(`${name} (try ${i}/${attempts})`, fn, log); }
    catch (e) { if (e.name === "AbortError" || i >= attempts) throw e; await sleep(retryDelayMs); }
  }
}

/** Step 1 (user gesture required): show the browser's device chooser. */
export async function chooseDevice(bluetooth, { log = () => {} } = {}) {
  if (!bluetooth || typeof bluetooth.requestDevice !== "function")
    throw new Error("Web Bluetooth not available in this browser (iOS Safari has none – use Bluefy)");
  // The band's advertisement content is not documented in our sources, so no name/service filter;
  // the 0x1A1A service must still be listed in optionalServices to be accessible after connect.
  return step("requestDevice", () => bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [GATT.service] }), log);
}

/** Step 2: GATT connect + discovery of the SAP service and its two characteristics. No writes. */
export async function connectAndDiscover(device, { log = () => {}, retryDelayMs = 2000, onDisconnect = () => {}, isCurrent = () => true } = {}) {
  const check = () => { if (!isCurrent()) throw Object.assign(new Error("stale connection generation"), { name: "AbortError" }); };
  const current = (fn) => async () => { check(); const result = await fn(); check(); return result; };
  device.addEventListener("gattserverdisconnected", onDisconnect);
  const server = await withRetry("gatt.connect", current(() => device.gatt.connect()), { log, retryDelayMs });
  const service = await withRetry("getPrimaryService 0x1A1A", current(() => server.getPrimaryService(GATT.service)), { log, retryDelayMs });
  let characteristics = [];
  try {
    characteristics = await step("getCharacteristics", () => service.getCharacteristics(), log);
    for (const c of characteristics) {
      const p = c.properties || {};
      log(`  char ${c.uuid} read=${!!p.read} write=${!!p.write} wwr=${!!p.writeWithoutResponse} notify=${!!p.notify} indicate=${!!p.indicate}`);
    }
  } catch { /* listing is diagnostic only */ }
  check();
  const notifyChar = await step("get notify characteristic", () => service.getCharacteristic(GATT.notify), log);
  const writeChar = await step("get write characteristic", () => service.getCharacteristic(GATT.write), log);
  check();
  const writeMode = writeChar.properties && writeChar.properties.write ? "with-response" : "without-response";
  log(`write mode: ${writeMode}`);
  return { device, server, service, characteristics, notifyChar, writeChar, writeMode };
}

/** Step 3: subscribe to band → phone notifications. The first attempt may trigger the iOS pairing prompt. */
export async function subscribe(link, onBytes, { log = () => {}, retryDelayMs = 2000, isCurrent = () => true } = {}) {
  link.notifyChar.addEventListener("characteristicvaluechanged", (e) => {
    if (!isCurrent()) return;
    const v = e.target.value;
    onBytes(Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
  });
  await withRetry("startNotifications", () => { if (!isCurrent()) throw Object.assign(new Error("stale subscription generation"), { name: "AbortError" }); return link.notifyChar.startNotifications(); }, { log, attempts: 4, retryDelayMs });
}

/** Writer creation is deliberately unavailable: passive capture has no transport egress. */
export function makeWriter() {
  throw new Error("PASSIVE: no transport writer; exact payload/identity approval required");
}
