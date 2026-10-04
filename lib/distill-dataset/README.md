# @workspace/distill-dataset

Git-safe distillation **manifest** types + validators, train-safety checks, and near-dup (Jaccard/shingle) helpers for sequence-level QLoRA datasets.

## Install into monorepo

```bash
# from repo root
cp -R path/to/lib-distill-dataset lib/distill-dataset
# wire package into pnpm workspace if not auto-picked (see pnpm-workspace.yaml)
pnpm install
pnpm --filter @workspace/distill-dataset test
pnpm --filter @workspace/distill-dataset typecheck
```

## API

| Export | Purpose |
|--------|---------|
| `validateDistillManifestEntry` | Public/git row (hashes + metadata only) |
| `validateDistillTrainingExample` | Private example including `messages` |
| `assessTrainSafety` | Hard rejects: bad JSON, fences, blank-poison, verification, dup/leak flags |
| `assertBrandPartitionIntegrity` | No brand in two of train/dev/holdout |
| `toManifestEntry` | Strip messages for git manifest |
| `normalizeForNearDup` / `shingleSet` / `jaccard` | Building blocks |
| `jaccardTexts` | Similarity of two raw strings |
| `findNearDuplicates` | All pairs ≥ threshold |
| `trainNearDupFlags` | Per train-id flag vs dev/holdout (feeds `assessTrainSafety`) |

### Near-dup defaults

- Word 3-grams, Jaccard threshold **0.85**, normalize v1 (NFC, lower, collapse space)
- Pure TypeScript, no extra dependencies
- O(n²) pair checks — appropriate for small distill corpora

```ts
const flags = trainNearDupFlags(trainChunks, devAndHoldout, { threshold: 0.85 });
for (const example of candidates) {
  const f = flags.get(example.id);
  assessTrainSafety(example, { nearDuplicateOfHoldout: f?.flag ?? false });
}
```

## Privacy

- **Repo:** manifest entries only (`contentSha256`, brand, partition, verified).
- **Private store:** full `messages` with pinned production system prompt + assistant JSON.

## Not included (by design)

- Apply-log backfill scripts
- Unsloth training runner
- MinHash/LSH (add later if n grows large)

See research docs: `qlora-unsloth-config-and-train-checklist-2026-09-28.md`, `near-dup-hashing-research-2026-09-28.md`.
