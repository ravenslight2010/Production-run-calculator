# Editable skills audit

Date: 2026-08-25

## Reviewed

Reviewed all 24 editable `SKILL.md` files under `.agents/skills/` and
`.local/custom_skills/`. Checked frontmatter identifiers and descriptions,
trigger clarity, scope, imperative guidance, progressive-disclosure pointers,
overlap, safety boundaries, and output contracts.

## Changed

- Normalized all 10 custom-skill frontmatter names to lowercase hyphenated
  identifiers while preserving their directories and intent.
- Strengthened custom skills with explicit scope, stop conditions, and output
  contracts; improved trigger descriptions for discovery.
- Made `review-before-shipping` compose with `release-checklist` instead of
  duplicating repository-specific gates.
- Added maintenance-mode, safety, and completion guidance to `skill-creator`.
- Added focused evals with assertions for `skill-creator`, `release-checklist`,
  and `review-before-shipping`.

## Passed

- All editable skill files have YAML frontmatter with `name` and `description`.
- All names match `^[a-z0-9-]{1,64}$`; descriptions are specific and under
  the 1024-character limit.
- Every materially changed high-risk skill has two realistic eval prompts and
  objective assertions.
- No application code, platform-managed skill, or release behavior was changed.

## Deferred intentionally

- `.local/skills/skill-authoring/SKILL.md` and
  `.local/skills/project-tasks/SKILL.md` were reviewed as platform-managed
  guidance and were not edited.
- A full trigger-optimization benchmark and interactive viewer run were
  deferred because this audit found metadata and safety-contract issues, not a
  measured trigger-rate regression.
- Existing project-specific skills with valid metadata and adequate contracts
  were left unchanged to avoid needless churn.

## Ownership and routing record

- Root ownership, precedence for duplicate names, the `skill-creator` overlap,
  and the schema-checklist relationship are documented in
  `.agents/skills/README.md`.
- `.local/secondary_skills/` and `.local/skills/` remain read-only. Findings
  about their content are recorded as routing/documentation issues rather than
  fixed by editing managed files.
- The deterministic trigger preflight is not used to rewrite descriptions
  without model-evaluation evidence; provider-specific benchmark behavior
  remains separate from catalog maintenance.