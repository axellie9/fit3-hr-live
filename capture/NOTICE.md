# NOTICE — licensing and attribution

This web probe (`site/`, `tests/`, `tools/`) is free software distributed under the
**GNU General Public License version 3 only (GPL-3.0-only)**. The full license text is in
[`LICENSE`](LICENSE) (byte-identical copy of the LICENSE file shipped by both upstream projects,
sha256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`).

## Upstream works this is derived from

| Project | Commit inspected | License | What was ported |
|---|---|---|---|
| [yuriyurin/Fit3-App](https://github.com/yuriyurin/Fit3-App) (Android companion, Kotlin) | `1ac39f063fe5d0bcae72c71acf40d40218752365` | GPL-3.0-only (README: "GNU GPLv3 (GPL-3.0-only)") | GATT UUIDs (`ble/Fit3BleClient.kt`), SAP framing (`protocol/Fit3SapCodec.kt`), battery (`Fit3BatteryCodec.kt`), Health service 10: GM/wearable capability replies, host probe, REQUEST_DATA, SYNC_DATA acks, type-7 step intervals, type-10 heart-rate records, large-data chunks (`Fit3HealthCodec.kt`, `Fit3VitalCodec.kt`, `Fit3HealthLargeDataReceiver.kt`). Test vectors copied from its unit tests into `tests/fixtures/vectors.mjs` (labelled UPSTREAM_VECTOR). |
| [GokulArumugam/Fit3Bridge](https://github.com/GokulArumugam/Fit3Bridge) (independent hobby iOS port) | `f31d89295394c1d1f811786695877b44dfa64aea` | GPL-3.0 (LICENSE = GPL v3 text; protocol derived from Fit3-App) | JS framing/CRC/reassembly/handshake/battery helpers (`web/fit3.js`), Bluefy connect sequence (`web/index.html`), WatchInfo test vector. |

**Not the commercial app.** `GokulArumugam/Fit3Bridge` is unrelated to the paid App Store app
"Fit3 Bridge" (developer Christopher Axel Chavez, fit3bridge.com). No code, binary or asset of that
commercial app was obtained or used.

**Not used:** the call-service (SAP 3) code in GokulArumugam/Fit3Bridge, which its own docs say was
recovered by decompiling Samsung's plugin; notification, watch-face, OOBE InitSettings/UserAgreement,
OTA/firmware, goals and pedometer back-sync code from either project.

**Provenance caveat (upstream statement, not verified by us):** Fit3-App's `Fit3HealthCodec.kt` says its
Health command/field ids were "recovered from Samsung's Fit3 plugin". We ported only the GPL-licensed
Kotlin logic from that repository; no Samsung code or assets are included here. The owner should be aware
of this upstream provenance before any redistribution.

Modifications relative to upstream (GPL §5a): subset port to JavaScript, outbound allowlist
(`classifyOutbound`), explicit arming toggles, raw-sample health parsers instead of merged app state,
local log export with redaction. Date of modification: 2026-10-30.

## HR BINNING protocol-fact review — v2-hr-binning-r1

The recovered primary comparison source was read locally at
`followup-research/gadgetbridge-samsung-source/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/samsung/requests/Fit3HealthHeartRateRecord.java`
(relative to the project root, not included in this source ZIP), from the reconstruction recorded as
Gadgetbridge PR 7052 final commit `1af5b4468811bbb66224b72059b0fd1c791343e1`.
Its notice is **Copyright (C) 2026 Vitaliy Tomin, AGPL-3.0-or-later**. This is attribution for the
protocol-fact evidence, **not** a relicensing claim: no Java implementation, comments, or source file
from that AGPL work was copied into the GPL prototype/archive. No downloaded Java was executed.
The new JavaScript behavior was implemented independently within the existing GPL tag-map decoder,
using the documented wire widths, BINNING byte cap/alignment, minute offsets and scalar-vs-bin rules.
All new fixtures are explicitly SYNTHETIC, not copies of capture bytes or a Java oracle's results.
Existing GPL licenses, upstream notices and copyrights are preserved. See `HR_BINNING_REVIEW.md`.

Not affiliated with or endorsed by Samsung. "Galaxy Fit3" is a Samsung trademark.

## History-r1 passive diagnostic modifications

This separately owned revision preserves the original notices/license and narrowly
copies the files enumerated in `COPY_ALLOWLIST.json`. `historical/` is a byte-for-byte
reference of those files, NOT a deployable runtime. No old logs, private capture,
cache, archive, UI assets or commercial implementation were copied.

Modified runtime: `site/session.js` disables every automatic and manual transport
write irrespective of old arming flags, adds bounded RAM RX/TX journaling and an
explicit local export API. `site/ble.js` refuses writer creation in every mode.
Tests strengthen the output contract rather than rewriting historical assertions;
legacy session and driver assertions remain in `historical/tests/`.
New tests/docs and these modifications use GPL-3.0-only, consistent with the inherited
runtime. Modification checkpoint: history-r1, 2026-10-31. No proprietary or new
AGPL implementation was copied. See `REVIEW_HANDOFF.md` for exact verification limits.

