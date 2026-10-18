---
name: Local browser suite routing
description: How to run isolated browser journeys that launch local HTTP API and web servers without permitting package downloads.
---

For Playwright journeys that use the isolated database runner and local HTTP services, invoke the isolated runner with package-manager offline mode instead of placing the whole journey behind the HTTPS-only release proxy.

**Why:** The release proxy rejects Node cleartext HTTP requests, including intentional loopback service traffic. Offline package-manager mode keeps dependency acquisition fail-closed while allowing the test's local API and web server requests.

**How to apply:** Use `npm_config_offline=true` with `scripts/src/run-isolated-browser-suite.sh` for preinstalled browser suites. If a test needs packages that are not already installed, resolve that setup separately rather than disabling the proxy guard or allowing cleartext package downloads.
