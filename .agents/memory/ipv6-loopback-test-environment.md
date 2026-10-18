---
name: IPv6 loopback test environment
description: Isolated shells may not expose IPv6 sockets, preventing local HTTPS identity tests from reaching their certificate assertions.
---

Some isolated workspace shells reject IPv6 socket creation with `EAFNOSUPPORT`, including attempts to bind an HTTPS fixture to `::1`. This is an environment limitation, not evidence of an application TLS failure.

**Why:** A test that cannot establish the local TCP connection cannot exercise certificate IP-SAN matching. Skipping the case or replacing the network request with a hostname helper would hide the security-relevant behavior.

**How to apply:** Keep IPv6 identity tests strict. When the local runtime lacks `AF_INET6`, run the test in an IPv6-capable CI or execution environment and record the local result as blocked; do not disable certificate verification or silently skip the test.
