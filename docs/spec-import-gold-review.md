# Spec-import gold review CLI

The CLI validates a private review bundle and prints a minimized aggregate
report. It does not authorize source use, inspect workbooks, produce labels, or
replace human review. It must not be used to justify opening customer source
material before the source owner has authorized accuracy-evaluation use.

## Before review starts

The source owner must authorize the permitted records for spec-import accuracy
evaluation and confirm the use fits applicable customer terms and retention
rules. Store that authorization, the source workbooks, source locations, labels,
and identity mapping in an access-controlled location outside Git. Arrange
separate reviewer access so neither reviewer can see the other's labels or
parser/provider output. A separate adjudicator and privacy reviewer are also
required.

The CLI can check that its input file resolves outside the repository and that
the bundle contains these attestations. It cannot verify the source owner's
identity, the authenticity of the authorization record, or the access-control
rules on an external store. Its report marks those claims
`recorded_not_independently_verified` and
`attested_not_independently_verified`.

## Run

```sh
pnpm --filter @workspace/scripts run spec-import-gold-review -- \
  --bundle /absolute/private/location/spec-import-gold-review.json
```

The input must be an absolute path outside the repository, point to a regular
JSON file, and be no larger than 25 MiB. The CLI reads only that file; it does
not follow source references or open workbook files. It writes one aggregate
JSON report to standard output. Do not redirect private bundle contents into
Git.

Exit code `0` means the bundle passed structural and global-gate validation and
an aggregate was produced; inspect `status` and `issueCodes` because individual
cases may still be incomplete or ineligible. Exit code `2` means the bundle
could not be evaluated because its schema, global prerequisites, or source scope
failed. The report contains fixed status codes, aggregate counts, coarse
attestation states, and parse/prompt identity. It omits case IDs, source
references, reviewer identities, label values, and file paths.

## Bundle contract

Use format `spec-import-gold-review-bundle`, version `1`, with these fields:

| Section | Required information |
| --- | --- |
| `screening` | `screenedCaseCount`, at least the number of case records in the bundle |
| `evaluation` | Numeric-string `parseVersion` and lowercase SHA-256 `systemPromptSha256` |
| `authorization` | `decision`, `evaluationUse: "spec-import-accuracy"`, opaque authorization reference, approval time, terms/retention confirmation, and the opaque source references in scope |
| `storage` | `outsideRepository`, `accessControlConfirmed`, an opaque access-review reference, and review time |
| `privacyReview` | Approval decision, opaque reviewer and review references, review time, and confirmation that source content and identity mappings are excluded from the report |
| `cases` | Authorized case records, each with an opaque case ID, source kind/reference, up to two reviewer records, and optional adjudication |

References use a type prefix plus 16–64 lowercase hexadecimal characters:
`auth_…`, `access_…`, `privacy_…`, `source_…`, `case_…`, or `reviewer_…`.
Generate random opaque references; do not use customer names, filenames,
workbook hashes, or hashes of identities as identifiers. Keep the mapping from
these references to real identities and sources in the restricted store.

Each reviewer record includes a distinct opaque `reviewerRef`, a source-open
time after authorization and the access-control review, a review time after the
source-open time,
`blindToParserProviderOutput: true`,
`blindToOtherReviewer: true`, and a `labels` object covering every field in the
fixed critical-field checklist: `profile.brand`, `profile.flavor`,
`profile.allergens`, `profile.pizzasPerCase`, `profile.dieType`,
`profile.doughOrCrust`, `profile.doughballWeight`,
`profile.doughballsPerTray`, `profile.sauceIdentity`,
`profile.sauceOzPerPizza`, `profile.applicatorIdentitiesAndWeights`,
`profile.pepperoniIdentitiesAndWeights`, `recipe.kind`, `recipe.name`,
`recipe.ingredientRows`, `recipe.units`, and `recipe.profileTargets`.
Both reviewers label the entire checklist independently. Use
`{ "state": "not_applicable" }` when a field category does not apply to that
case, `{ "state": "not_present" }` when an applicable field is absent, or
`{ "state": "unclear" }` / `{ "state": "not_inferable" }` when source evidence
does not support a confident value. Otherwise use
`{ "state": "value", "value": ... }`. The `value` may contain structured recipe
rows and units; all such values stay in the private bundle. The separate
adjudicator must confirm the critical-field coverage against source evidence.

An adjudication records a third opaque reviewer reference, a time after both
independent reviews, `sourceChecked: true`, `fieldCoverageChecked: true`, an
outcome, and `resolvedFields`. Use `confirmed_agreement` with an empty
`resolvedFields` object when labels agree. For disagreements, use
`resolved_disagreements` and provide a source-checked resolution for every
differing field and no others.

## Reading the aggregate report

`caseCounts` distinguishes screened, authorized, independently double-labeled,
adjudicated, eligible, and incomplete/ineligible cases. `fieldCounts` counts
applicable and finalized critical fields for eligible cases, plus unknown
(`unclear` or `not_inferable`) finalized fields, without field names or values.
`not_applicable` fields are excluded. A case with no applicable critical fields
is ineligible. Only cases with in-scope sources, two independent blind labels
covering the full fixed checklist, separate source-based adjudication, and
approved global authorization, storage, and privacy attestations count as
eligible.

`unreviewedPrivateStoreCaseCount` is always `null` with status
`unknown_not_accessed`. A report scoped to one provided bundle does not establish
how many cases exist in other private stores. A missing bundle or failed global
gate produces no case counts; it is not evidence that private stores contain
zero cases.

The report is review evidence, not a provider benchmark, training approval, or
authorization for any additional use. Provider comparison still requires its
own approved model/settings and a separately authorized evaluation decision.
