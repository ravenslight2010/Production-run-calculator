---
name: npm tarball transport boundary
description: Distinguishes certificate validation from preventing an HTTPS tarball request from redirecting to HTTP.
---

# Strict TLS does not guarantee HTTPS-only tarball redirects

Do not treat `strict-ssl=true` or a trusted CA as proof that npm will reject a tarball redirect from HTTPS to HTTP. Those settings validate TLS when TLS is used; they do not necessarily enforce a minimum transport security level across redirects.

**Why:** An installed npm/npx client can successfully download a valid, integrity-matching package from a loopback HTTP endpoint after an HTTPS registry redirects the tarball URL there, and can execute the package command.

**How to apply:** When validating npm package transport, test HTTPS-to-HTTP redirects independently from certificate and integrity checks. Record whether the HTTP listener is reached and whether the package command executes; do not report the boundary as enforced based only on successful TLS verification of the registry.
