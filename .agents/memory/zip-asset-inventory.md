---
name: ZIP asset inventory safety
description: Rules for reviewing uploaded ZIP archives before any extraction or execution.
---

Inspect uploaded ZIPs through the central directory only; never extract or open members during the first-pass review. Treat traversal, normalized or case-fold collisions, encryption, special-file metadata, and size-limit breaches as fail-closed findings. Archive-level duplicate hashes are review findings, not installation approval.

**Why:** Uploaded skill bundles can contain symlinks, credential-like filenames, duplicate uploads, and unsafe paths; a metadata-only pass reduces exposure while preserving enough evidence to decide what needs manual review.

**How to apply:** Keep reports redacted to archive identity, hashes, bounded counts, limits, and stable error codes. Label every result as review evidence rather than permission to install or execute.