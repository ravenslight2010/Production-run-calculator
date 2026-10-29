---
name: Browser compatibility evidence index
description: Pointers to non-obvious auth, isolated browser, touch selection and storage constraints.
---

- [Slow-network auth timing](slow-network-auth-timing.md): include session confirmation in authenticated cold-start measurements.
- [Isolated matrices](browser-matrix-isolation.md): isolate the failed browser profile before diagnosing a matrix timeout as a defect.
- [Active picker assertions](browser-evidence-assertions.md): hidden touch-dialog inputs can match global selectors.
- [Unavailable storage](browser-localstorage-availability.md): do not assume localStorage access.
- [Phone form overrides](phone-e2e-form-overrides.md): phone fixture boundaries.
- [Generated query coercion](orval-query-coerce-quirk.md): absent query parameters need explicit handling.
- [WebKit GIO TLS](webkit-gio-tls-runtime.md) and [IPv6 loopback](ipv6-loopback-test-environment.md): keep trust enabled; load Nix TLS modules and block unsupported AF_INET6 identity checks.
- [WebKit push tests](local-browser-suite-routing.md): WPE can hang on push APIs; use active registrations and clearly scoped empty-subscription fixtures.
