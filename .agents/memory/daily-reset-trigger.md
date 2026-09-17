---
name: Daily reset / session boundary trigger model
description: How server-owned facility rollover and browser baseline adoption protect the current-day schedule.
---

# Daily reset trigger model

For the web bootstrap, facility rollover is server-owned. The server activates
the client-date current-day row, advances the reset epoch, and broadcasts the
rollover/session boundary. The browser adopts that epoch without a broad cache
wipe, reloads, and accepts the authoritative current-day SSE baseline before
automatic writes can resume.

- A stale prior-day cache, a clean browser, and a device behind the rollover
  epoch all wait for the same canonical current-day baseline.
- The client must not archive stale local day state, stamp a new rollover
  marker, or publish an inferred empty replacement during bootstrap.
- An administrative reset remains distinct: `applyResetWipe` performs the
  intentional broad purge, while rollover adoption preserves profiles, history,
  and durable outboxes.
- The date guard still rejects queued or retrying writes whose payload date is
  no longer the local production date.

**Why:** a mount-time client rollover can race the reset-epoch handshake and
initial snapshot. It can replace the local day, advance a newer marker, and
queue an empty write while the server is still hydrating a retained schedule.
The server-owned epoch plus baseline gate gives every first-login entry state one
adoption owner.

**How to apply:** keep reset/rollover handling behind the epoch and canonical
baseline gates. Preserve the fresh-session versus restored-session distinction
through the server authentication boundary; do not reintroduce a web timer that
mutates today's day state.