---
name: GitHub workflow-file scope
description: The connected GitHub OAuth authorization can write ordinary repository files but not .github/workflows files.
---

The connected GitHub OAuth grant exposes `repo` but not the separate workflow-file permission. Through the Replit GitHub proxy, ordinary contents writes succeed while writes targeting `.github/workflows/*` are rejected by an upstream 403 page; lower-level Git tree creation may also be unsupported.

**Why:** Live scheduled- versus manual-event proof needs a workflow in a disposable repository, but the connector cannot install that fixture without workflow-file authorization.

**How to apply:** Treat static/local alert fixtures as valid fallback coverage, but do not claim live Actions delivery evidence unless a fixture workflow was pre-created or the GitHub authorization explicitly supports workflow-file writes.