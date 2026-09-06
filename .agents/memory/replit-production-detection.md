---
name: Replit production detection
description: How to distinguish an actual deployed runtime from an isolated Replit workspace when guarding destructive commands.
---

Do not treat `REPLIT_ENVIRONMENT=production` by itself as proof that a command is
running against a deployed production environment. Isolated task workspaces can
carry that value.

**Why:** A destructive-operation preflight initially used this label as a hard
production fence and incorrectly blocked the isolated environment it was built
to prepare.

**How to apply:** For fail-closed database tooling, combine explicit deployment
or runtime markers with independent disposable-database proof. Keep shared
remote databases denied unless an approved test-mode contract is present.