---
name: HTTP security policy
description: The app's narrow CSP resource allowlist and TLS-terminator ownership for HSTS.
---

The production app is same-origin for API, authentication, sync, and push. Its CSP should keep scripts and connections first-party, while allowing the observed Google Fonts stylesheet/font hosts and the QR-image service. Inline styles are required by the current client UI; do not weaken script policy or add broad HTTPS wildcards as a shortcut. Framing remains denied.

**Why:** The client has a few intentional external visual resources, while normal app traffic and web-push setup use same-origin routes. A broad source wildcard would erase much of CSP's value without being necessary.

**How to apply:** Recheck `index.html`, CSS imports, image URLs, service-worker registration, and API origin when changing CSP. Set HSTS only at a response-serving layer that is known to terminate HTTPS; Express must not infer that from `NODE_ENV` or forwarded headers.
