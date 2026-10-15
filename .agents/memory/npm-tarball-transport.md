---
name: npm tarball transport boundary
description: Distinguishes certificate validation from preventing an HTTPS tarball request from redirecting to HTTP.
---

# Strict TLS does not guarantee HTTPS-only tarball redirects

Do not treat `strict-ssl=true` or a trusted CA as proof that npm will reject a tarball redirect from HTTPS to HTTP. Those settings validate TLS when TLS is used; they do not necessarily enforce a minimum transport security level across redirects.

**Why:** An installed npm/npx client can successfully download a valid, integrity-matching package from a loopback HTTP endpoint after an HTTPS registry redirects the tarball URL there, and can execute the package command.

Node hooks do not necessarily cover the package manager itself. A native package manager can bypass Node's HTTP hooks, so enforce release-download transport at a proxy or network boundary when needed. For TLS tunnels, allow HTTPS through unchanged so the package manager still validates the remote certificate.

**Why:** A native pnpm client bypassed the Node hooks while following a valid HTTPS registry's HTTP tarball redirect; only a fresh-cache test of the actual pinned manager exposed the gap.

**How to apply:** Test redirects independently from certificate and integrity checks, using the actual pinned installer and a loopback HTTP listener. Confirm the listener is never reached, while valid HTTPS and invalid-certificate cases still prove normal TLS verification remains active.
