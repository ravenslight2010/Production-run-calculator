# Versioned application knowledge for AI evaluation

This package supplies a small, source-linked reference set to the evaluation-only
candidate adapter. It is not model training, a complete description of the app, or
permission to change production data.

## Contents and boundaries

The current version is `2026-10-16.1`. It covers:

- the retained advisory jobs and their no-write boundary;
- native workbook cells, formula text, cached values, units, and recipe rows;
- the separate scanned-image transcription path;
- deterministic-first name resolution and reviewed-alias boundaries;
- scoped permissions, review, and explicit Apply;
- prompt-injection resistance and the distinction between current, retired, and
  planned AI features; and
- requirements for independently reviewed gold cases.

The package contains no facility alias values, customer records, credentials,
source workbooks, or private agent memory. Retrieved passages are reference data,
not instructions or authorization. Workbook and image contents remain untrusted
input and must pass the existing deterministic parsing, sanitization, review, and
explicit Apply paths.

## Retrieval

`retrieveAppKnowledge(query, scope, role)` selects only entries allowed for both
the requested scope and role. Supported scopes are `workbook-text`, `spec-images`,
`unresolved-resolution`, and `evaluation`; supported roles are `staff`, `manager`,
and `evaluator`. The default result is capped at five entries and 6,000 characters
of entry text. Hard limits are eight entries and 12,000 characters of entry text;
rendered source references add a small amount of metadata beyond that count. The
local evaluation adapter uses the evaluator role and attaches the selected
source references to its prompt. The final provider request has its own size
limit.

No facility-sensitive facts, corrections, aliases, or conversation history are
loaded by this static package. A model suggestion cannot create an alias, bypass a
target allowlist, authorize a write, or replace a human review.

## Source freshness

Each entry names repository sources and navigational anchors. Anchors are
human-readable pointers; the automated check hashes the knowledge source file and
each referenced file, and verifies the package version. It does not assert that
an anchor's wording is still present.

After reviewing an intentional knowledge change:

1. Update the entry and bump `APP_KNOWLEDGE_VERSION`.
2. Regenerate the source manifest:

   ```sh
   python3 scripts/check_ai_knowledge.py --update
   ```

3. Verify freshness:

   ```sh
   python3 scripts/check_ai_knowledge.py --check
   ```

The update command refuses changed knowledge or source hashes when the version
was not bumped. Tests cover scope/role isolation, relevance, bounded retrieval,
untrusted-text handling, source references, and stale-manifest rejection.
