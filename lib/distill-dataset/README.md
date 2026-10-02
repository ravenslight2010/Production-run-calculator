# Verified distillation dataset preparation

This package provides deterministic validation, redaction, brand partitioning,
and duplicate checks for private spec-import evidence. It does not call a model,
create labels, train a model, or access a database.

## Current decision

The checked-in decision at
`docs/evidence/distillation-backfill-decision-2026-10-02.json` is **no-go**.
The CLI checks that decision before it reads any candidate file or creates an
output directory. The current run must emit zero examples.

## Inputs

Evidence is supplied as JSONL files in a private location outside the repository.
The evidence collector must be access-controlled and trusted: this CLI checks
record structure, actor capability claims, and content digests, but a SHA-256
digest does not authenticate who created or approved a record. Do not hand-author
records or treat their hashes as signatures.

- `corpus` records need independently reviewed, source-backed gold fields and
  deterministic output that agrees with both the gold and the candidate output.
  Repository corpus snapshots are regression expectations, not gold labels.
- `applylog` records need a live, completed import Apply record by a
  `manage-profiles` actor, linked to the exact source text and containing the
  applied values. Undone, pending, sandbox, or unauthenticated records are
  quarantined.

Each JSONL record uses the `DistillCandidateInput` shape exported by this
package. In particular, `sourceText` must be included in `userContent`;
`systemPromptSha256` must match the current production prompt and `parseVersion`
must match `SPEC_PARSE_VERSION`; critical fields use dotted paths such as
`profiles.0.brand`. Corpus gold values are keyed by those dotted paths, and
their digest binds them to the source digest. Apply-log records carry a digest
over the completed action and applied values. These digests detect accidental
or partial changes; trusted export and review systems remain responsible for
identity and authorization. Candidate input files must not be committed.

## Run

```sh
pnpm --filter @workspace/scripts run distill:backfill -- \
  --source both \
  --decision "$PWD/docs/evidence/distillation-backfill-decision-2026-10-02.json" \
  --corpus-evidence /private/path/corpus.jsonl \
  --applylog-evidence /private/path/applylog.jsonl \
  --out /private/path/distill-run \
  --manifest "$PWD/docs/evidence/distill-dataset-manifest.json"
```

The command deliberately exits with a no-go under the current decision. A future
go decision must record passing benchmark and training-evaluation outcomes,
approved dataset-safety review, matching prompt and parse pins, and a manager
approval record. The CLI does not provide a way to bypass that gate.

Available controls are `--source corpus|applylog|both`, `--dry-run`,
`--only quarantine`, `--max-per-brand N`, `--strict`, and
`--i-understand-small-holdout`. Fewer than seven eligible brands produces a
warning and requires the explicit small-holdout acknowledgment before partition
output. Even with that acknowledgment, strict mode treats the warning as a
failure. Inputs are limited to 100 MiB, 5,000 candidates total, and 1 MiB per
candidate record.

Configured redaction runs against output copies only. The default rules preserve
tab/newline structure while redacting configured sensitive columns. A custom
redaction config must also live outside the repository. Every output directory
must be outside the repository; the CLI creates files with owner-only
permissions. The committed manifest is an explicit metadata allow-list of
hashed IDs, hashes, partition/source labels, parse pins, verification paths,
and edit distances; it never includes prompts, workbook text, brands, or
generated messages.

Quarantine output is private and redacted. Its report contains aggregate counts,
hashed brand codes, verification paths, reason codes, and a digest of the
quarantine decisions. If quarantine is non-empty, train/dev/holdout files are
not accepted until a trusted review process records a manager receipt referencing
that exact report digest and explicitly confirms the quarantined items remain
excluded. The CLI validates receipt fields but cannot authenticate a reviewer;
the receipt does not turn quarantined candidates into training data.