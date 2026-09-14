---
name: ZIP asset inventory safety
description: Rules for reviewing uploaded ZIP archives before any extraction or execution.
---

Inspect uploaded ZIPs through the central directory only; never extract or open members during the first-pass review. Treat traversal, normalized or case-fold collisions, encryption, special-file metadata, and size-limit breaches as fail-closed findings. Archive-level duplicate hashes are review findings, not installation approval.

**Why:** Uploaded skill bundles can contain symlinks, credential-like filenames, duplicate uploads, and unsafe paths; a metadata-only pass reduces exposure while preserving enough evidence to decide what needs manual review.

**How to apply:** Keep reports redacted to archive identity, hashes, bounded counts, limits, and stable error codes. Label every result as review evidence rather than permission to install or execute.

Retained JSON reviews also need bounded provenance: UTC capture time, an allowlisted environment
class, a fixed scanner command identity, and a validated source revision. Do not copy output
paths, command arguments, environment values, or archive contents into that envelope.

**Why:** A retained scan must be attributable to the scanner revision that produced it without
turning review metadata into a path, credential, or payload disclosure channel.

**How to apply:** Use the scanner's explicit JSON output option for retention and keep the
existing review-only/not-installation-approval label unchanged.

Keep the emitted redacted report fields and the retained-report validator's exact-key
allowlists in lockstep, including newly added safety counters and policy identifiers.

**Why:** A scanner can produce a valid current report that its own retained-review
validator rejects if a new bounded field is added in only one place.

**How to apply:** When adding a report or archive field, update both schema allowlists
and include a current-report validation assertion in the focused inventory suite.