---
name: PWA deferred cache policy
description: Decide whether lazy-loaded application modules can safely be omitted from Workbox precache.
---

Do not treat a lazy import as proof that its feature is online-only. Workbox precache exclusions change offline feature availability; retain a deferred feature until route-level evidence proves its important work cannot be used offline, and get owner approval before removing that availability.

**Why:** Client-side workbook generation and parsing still work without the network, while other parts of the same feature may call APIs. Excluding a chunk because a different action needs the server can remove useful offline behavior.

**How to apply:** Trace deferred imports to their routes, inspect which operations are local versus server-backed, verify representative actions from an installed cold-offline build and after reconnect in Chromium and WebKit, and keep an explicit manifest assertion for workflows that must remain available.
