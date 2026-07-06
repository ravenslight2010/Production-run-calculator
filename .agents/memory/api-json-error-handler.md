---
name: API JSON error handler
description: Why the Express API must have a terminal JSON error-handling middleware, and what breaks without it.
---

# API must return JSON on errors, never HTML

The Express API mounts a terminal error-handling middleware (4-arg `(err, req, res, next)`) AFTER the router in `app.ts`. It normalizes thrown route errors and body-parser failures (413 `PayloadTooLargeError`, 400 JSON `SyntaxError`) into a JSON `{ error }` with the right status, logs via `req.log`, and never echoes raw 5xx messages.

**Why:** Without it, thrown errors fall through to Express's DEFAULT handler, which sends an **HTML stack-trace page**. Every client parses error bodies with `res.json()`, which throws on HTML — so the real reason is lost and the failure surfaces as a bare "error <status>" with no cause. This made a reported "schedule import — N of N days could not be saved" failure completely undiagnosable: the happy path worked, but any error (even a 413) reached the user as an opaque status code. Clients (e.g. `commitMultiDayImport` in web `home.tsx`) also now fall back to `res.text()` (skipping HTML) when an error body isn't JSON.

**How to apply:** Keep this middleware as the server-wide standard; do not remove or relocate it ahead of the routers. Any new client code that reads an error response should prefer `res.json().error` and tolerate a non-JSON body. Note: normal per-day sync payloads are tiny (cheese recipes max ~470 bytes; dough/sauce recipe tables empty), so the 10MB body limit / 413 is NOT reachable by realistic schedule data — don't chase payload size for import failures; read the now-exposed status+message from the toast or the API workflow logs instead.
