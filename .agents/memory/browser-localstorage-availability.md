---
name: Browser localStorage availability
description: Treat localStorage as an optional cache and guard method and property access during authenticated startup.
---

Browser `localStorage` is an optional device cache, not a prerequisite for opening Home, authentication, or server-backed features. Failure can occur on property reads such as `length` as well as `getItem`, `setItem`, `removeItem`, `clear`, and `key`; guard enumeration and migration markers too. Startup retries and migrations should leave their work pending when storage is unavailable, and asynchronous startup helpers must resolve safely rather than create unhandled rejections.

**Why:** Privacy restrictions can reject every localStorage operation, including reads for unrelated keys. Catching only individual reads and writes is insufficient when a storage enumeration or migration runs during authenticated startup.

**How to apply:** When changing startup, migration, or queued-work code that uses localStorage, test a browser fixture that rejects the full Storage API, verify Home remains usable, and verify cache failure does not trigger unrelated recovery actions.
