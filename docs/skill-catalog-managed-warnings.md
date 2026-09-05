# Managed skill catalog warnings

The skill catalog treats `.agents/skills` and `.local/custom_skills` as
repository-owned and blocking. The `.local/skills` and
`.local/secondary_skills` roots are platform-managed: they can be injected or
updated outside this repository, so their findings remain non-blocking.

The reviewed managed findings are recorded in
`skill-catalog-managed-baseline.json`. The baseline is counted by finding code,
not just by skill path. This matters because an additional broken reference or
new policy violation in an otherwise known skill is printed as `WARN`, while
the reviewed finding is printed as `KNOWN`. A managed warning is never treated
as an editable-skill pass, and editable findings still fail the check.

## Review outcome

- Oversized managed documents are vendor guidance that exceeds the 500-line
  limit used for editable skills. They cannot be shortened safely in this
  repository.
- Broken managed references are either optional companion skills, generated
  output paths, project-supplied examples, or references to an optional
  application that is not present here. They are documented in the baseline
  with the reason they are not repository-owned repairs.
- The malformed frontmatter-adjacent note in the managed RevenueCat guide is
  retained as a known platform finding rather than rewritten locally.

Run `pnpm run check:skill-catalog` to review the inventory. A new managed
finding appears as `WARN` and increments the undocumented-warning count; the
command remains non-blocking for managed roots. A new editable finding appears
as `FAIL` and exits unsuccessfully.