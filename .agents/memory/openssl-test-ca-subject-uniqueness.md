---
name: OpenSSL test CA subject uniqueness
description: Avoid duplicate-subject failures when signing multiple fixture certificates with one OpenSSL CA database.
---

When one temporary OpenSSL CA signs multiple certificates, give each certificate a distinct subject or explicitly configure the CA database to allow duplicate subjects. Reusing a CSR with the default CA configuration is rejected even when the certificates have different validity dates or extensions.

**Why:** The CA database enforces subject uniqueness by default, so a second signing attempt fails before the TLS behavior under test can run.

**How to apply:** For separate leaf fixtures, create distinct CSRs and ensure each server uses the private key matching its certificate.
