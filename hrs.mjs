// SPDX-License-Identifier: MIT
// Independent implementation of Bluetooth SIG HRS; no Fit3Free code copied.
export const HRS_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
export const HRS_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';
export function parseHeartRate(input) {
  const bytes = input instanceof DataView ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
  if (bytes.length !== 2 || (bytes[0] & 0xf9)) throw new Error('Unsupported or truncated HRS packet');
  return {bpm:bytes[1], contact:(bytes[0] & 4) ? !!(bytes[0] & 2) : null, energyKj:null, rrSeconds:[]};
}
