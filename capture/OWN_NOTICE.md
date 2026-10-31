# Passive web capture checkpoint

Original page, stylesheet, lifecycle controller and tests: Copyright (C) 2026 passive-web contributors. Distributed under GPL-3.0-only; see LICENSE. This work is provided without warranty.

The three diagnostic JavaScript modules, LICENSE and NOTICE.md were copied byte-for-byte from the reviewed local diagnostic checkpoint. See SOURCE_HASHES.json for exact source paths, byte lengths and SHA-256 hashes; NOTICE.md preserves their upstream attribution and modification history. These source hashes identify code, not device provenance.

This addition wraps only passive choose/discover/subscribe and raw journaling. It supplies foreground lifecycle cancellation, bounded stop/disconnect, explicit discard and consented local export. It exposes no protocol action, reply, ACK, payload constructor or decoded health metric. Legacy constructors/refused methods remain inside the immutable copied modules but are never called by this page.

No AGPL Python decoder, owner capture, private screenshot, sample data, historical fixture, native app, account or upload code is included in the public allowlist. Tests contain synthetic GATT objects and are not public runtime assets.
