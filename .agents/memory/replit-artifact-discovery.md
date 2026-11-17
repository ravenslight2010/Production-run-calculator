---
name: Replit artifact discovery
description: Prevent archived artifact manifests from re-registering active previews and workflows.
---

An artifact remains registered when its app folder moves under an archive if the manifest stays at `.replit-artifact/artifact.toml`. Move the manifest outside that discovery directory to archive the app without recreating its preview and managed workflow.

**Why:** Replit discovers the app from the manifest location; moving the surrounding folder does not make the manifest inactive.

**How to apply:** Before archiving an artifact folder, relocate its manifest to a clearly named, non-discovery path and verify the artifact and managed workflow are removed. Restore the manifest only when intentionally reactivating that app.
