---
name: Local browser suite routing
description: How to run isolated browser journeys that launch local HTTP API and web servers without permitting package downloads.
---

For Playwright journeys that use the isolated database runner and local HTTP services, invoke the isolated runner with package-manager offline mode instead of placing the whole journey behind the HTTPS-only release proxy.

**Why:** The release proxy rejects Node cleartext HTTP requests, including intentional loopback service traffic. Offline package-manager mode keeps dependency acquisition fail-closed while allowing the test's local API and web server requests.

**How to apply:** Use `npm_config_offline=true` with `scripts/src/run-isolated-browser-suite.sh` for preinstalled browser suites. If a test needs packages that are not already installed, resolve that setup separately rather than disabling the proxy guard or allowing cleartext package downloads.

For production-mode authenticated browser tests, keep the app's `Secure` session cookie enabled and serve the local UI through disposable HTTPS. WebKit did not send that cookie from HTTP loopback. Chromium also rejected a self-signed service-worker script fetch even when the Playwright context ignored HTTPS errors.

**Why:** Browser service-worker script fetches can enforce certificate trust separately from ordinary page requests, so `ignoreHTTPSErrors` is not sufficient evidence that a self-signed local TLS setup works.

**How to apply:** Put an ephemeral, test-only TLS terminator in front of the isolated local app, trust a per-run CA for WebKit, and pin only the temporary Chromium leaf certificate when needed. Keep browser certificate validation enabled and health probes on the direct loopback API; do not disable production cookie security.

For WPE WebKit tests of Radix portal dialogs, Playwright role-name and CSS locator expectations may stall even when the trace shows the dialog open. Inspect its open role/state, visible bounds, and `aria-labelledby` title in one page-side DOM read; keep any real interaction as a browser input.

**Why:** The WebKit trace showed a correctly open, titled dialog while successive locator engines never resolved it; direct DOM inspection preserves the UI/accessibility assertions without masking a CSP failure.

**How to apply:** Use this only when an isolated WPE trace proves the rendered state but locator calls stall. Keep action paths (such as push setup) driven by real pointer input and assert the resulting response and UI text.

For isolated WPE WebKit push tests, `serviceWorker.ready` and `PushManager.getSubscription()` may remain pending even when `getRegistration()` returns an activated worker.

**Why:** The browser test hung on those APIs despite the registration being active, so waiting for them did not establish app readiness or test the UI.

**How to apply:** Use the active registration for app readiness. For WebKit-only UI/API tests, stub `getSubscription()` to return an empty subscription and label the fixture; do not describe this as native push-delivery verification.
