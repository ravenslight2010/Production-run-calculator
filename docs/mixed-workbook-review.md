# Related workbook review

## Approved design and ownership

The manager Import workspace groups related files for navigation, not mutation.
The owner approved a session-only queue with separate Apply confirmations.
The queue does not infer relatedness, importer type, customer or locale from names.
Users choose both the files and their types, and should review spec/recipe
workbooks first when later guides depend on their names.

The implementation reuses the existing lazy workbook workflow, importer dialogs,
`ImportSafetyReviewHost` and `importOperations`. It adds no API, database field,
inventory writer, Gold Lab behavior, QC lifecycle behavior or retained raw source.
The existing import preview, comparison, current-state fencing, operation retry
and supported guarded Undo remain owned by their importer.

## Lifecycle and failure design

- Up to 20 files form a tab-memory group. Each file has its own identity even
  when filenames repeat, explicit type, status and importer-provided progress.
- Selecting files does not prepare, apply, learn aliases or repair anything.
  Review starts one importer at a time. This also ensures later files prepare
  against state after earlier confirmed imports.
- Preparation failures retain an actionable failed item. Cancelling a preview
  is not a failed or ambiguous server operation. Closing a preview returns to
  the group; previously applied files are unaffected.
- Apply always enters the existing importer flow and safety review.
  Cancelling the safety review leaves the original preview available.
- Canonical spec/premix/cheese acknowledgements mark only that file applied.
  An unconfirmed save blocks replacing or closing that original review. Its
  original Apply or exact-ID retry remains the recovery action, not a new parse.
- Guide outcomes explicitly describe local verification, not server delivery.
  Selected-out or unresolved rows remain excluded, never automatically repaired.
- Schedule days remain separate requests and confirmations. A cancelled later
  day leaves earlier acknowledgements intact; unconfirmed day requests are
  described as unconfirmed, never as rolled back. No retry starts automatically.
- Cancelling queued remainder does not change active, applied, partial or
  uncertain items. Clearing the group is disabled during an active review.
  Retrying an ordinary failed/cancelled file explicitly opens a fresh review;
  applied, partial and uncertain files cannot be replayed from the queue.
- Reload/sign-out/scope/capability changes discard group memory. Existing durable
  operation recovery remains separate and is never cleared by group actions.

## Input and compatibility inventory

This is an orchestration change, not a new parser or a claim of exhaustive file
compatibility:

| Dimension | Covered boundary |
| --- | --- |
| Importer types | Spec/recipe, premix, cheese, shipping, sauce guide, dough guide, schedule |
| Containers | `.xlsx`, `.xls`, `.xlsm`, `.xlsb`, `.csv`, `.ods` forwarded unchanged to existing workbook readers; sauce guide `.docx`, `.doc`, `.txt` forwarded to its existing document reader |
| Names/locales | Unicode filenames, punctuation, date-like filenames and repeated names; no locale inference or new numeric/date coercion |
| Layouts | Existing single/multi-sheet, tabular/block and multi-day layouts remain the original importer's responsibility |
| Source comparisons | Original current-factory and last-successful-source comparisons remain in the original review |
| Lifecycle | Queued, preparing, reviewing, applying, applied, partial, failed, cancelled, unconfirmed; identity reset and original-ID recovery |
| Failure paths | Unsupported selection, queue bound, preparation error, cancellation, uncertain network result, unavailable recovery storage, stale reviewed state, partial schedules and capability loss |
| Web | Desktop, phone, tablet portrait/landscape; Chromium and WebKit applicability recorded in verification below |
| Exclusions | Spec photos/PDF entry paths stay standalone; no new parser support, persistent group/source retention, Apply all, shared transaction, group Undo, inventory writer, production changes or QC/Gold lifecycle changes |

Atomic safety behavior is covered by existing operation tests; grouping tests
exercise dispatch of every type without duplicating parser algorithms. Existing
source citation/workbook preparation tests remain separate evidence. Physical
Android Chrome and iOS Safari/PWA are not claimed by browser emulation; native
mobile is not applicable to this web-only app.

## Agent-owned execution and safeguards

Owner: assigned implementation agent. Evidence: source and tests in
`artifacts/run-calculator/src`, the managed web/API workflows, and synthetic
browser fixtures. No production writes or customer workbooks are needed.
User-controlled design approval was received before implementation.
Template download and QC work already have separate owners and are unchanged.

Applicable guidance: task-execution rules, React/Vite, import safety and source
retention decisions, error handling, verify-before-commit, and bounded
operational browser verification. No parser/prompt/version, schema, sync
transport, epoch, inventory math or API contract changed.

## Verification and failure ledger

- PASS: focused client source typecheck; full `CI=true pnpm run typecheck`.
- PASS: initial focused suite (45 passing, one existing private-corpus-dependent
  citation case skipped). New queue tests cover each importer, explicit routing,
  supported extensions, limits, duplicate/Unicode names, independent outcomes,
  cancellation, original pending identity, recovery storage and scope reset.
- FIXED: closed failed review could leave the rendered group blocked because
  clearing a ref did not render. Added state notification and regression.
- FIXED: a handled preparation failure could be overwritten as reviewing on
  return from preparation. Only the still-active preparation may advance.
- FIXED: a draft shipping summary accessed nullable prepared state. It now uses
  the importer's actual verified skipped-row count; client typecheck confirms it.
- FIXED within the input inventory: sauce guides use document files, not
  spreadsheets. The queue now accepts the existing `.docx`/`.doc`/`.txt` path,
  rejects incompatible type changes before preparation and tests these variants.
- FIXED from browser evidence: Settings (layer 70) intercepted pointer clicks
  on lower guide/schedule previews (layer 60). These previews now match the
  existing spec/premix/cheese layer 80, below safety confirmation layer 100;
  a layering regression guards every importer and shipping Close is touch-sized.
- FIXED in the new layering regression harness: browser-transformed asset URLs
  could not be read as filesystem source. The test now uses an explicit Node
  environment and resolved source paths, without changing application behavior.
- Existing `release:standard` workflow was already failed before this work:
  release shard inventory omitted the station-activity test group. This is
  unrelated release inventory evidence, not a queue test failure or release GO.
  The existing routine-validation work owns that surface; this task neither
  reruns release gates nor changes its inventory.
- PASS: single signed-in sandbox Chromium browser pass, using only synthetic
  shipping XLSX and schedule CSV. Explicit type routing, original shipping
  preview/source citations, keyboard cancellation, meaningful parser failure,
  type correction and reload clearing were observed. No Apply was clicked.
- PASS: Chromium responsive emulation at desktop 1440×900, phone 390×844,
  tablet portrait 768×1024 and landscape 1024×768; no document horizontal
  overflow; controls reachable by scrolling. WebKit/Safari: not run because
  the available tester session was Chromium. Physical Android/iOS/PWA: not
  run (emulation is not physical-device evidence); native mobile not applicable.
- Traffic limitation: no import Apply endpoint or importer profile write was
  identified. Ordinary background factory/day-state requests occurred; the
  browser capture lacked timestamps/payloads needed to attribute every one.
  No claim of globally zero application writes is made.
- Existing sandbox auth/session/resource errors and an Update failed banner
  recovered or did not block queue checks. They are not passing evidence for
  startup/auth/update recovery; that separately owned recovery work is unchanged.
- PASS: final focused suite: 63 passing, one pre-existing private-corpus-dependent
  case skipped, across eight selected files. Final client source typecheck and
  `git diff --check` pass. These cover the final sauce-document and dialog-layer
  fixes. The managed web workflow restarted successfully after the UI changes.
