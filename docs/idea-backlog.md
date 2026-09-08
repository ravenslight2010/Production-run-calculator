# Idea Backlog (working document)

Collection of improvement ideas gathered in Codex planning sessions.
NOT a commitment to build anything — a scratchpad for the owner to pick from.
Items are grouped by theme; no priority ordering is implied (the owner decides).

Related: `.agents/memory/replit-actions-needed.md` Sections 5-6 contain the
work items already handed to Replit Agent (CI fixes, wall-clock execution,
battery quick wins, server-side pushes, home.tsx split).

---

## 1. Battery life

- Pause the 30s `schedulePush` periodic sync when the tab is hidden
  (`home.tsx` ~line 9261) — biggest easy battery win.
- Consolidate the 3× 60s timers (memory sample, profile reconcile, date
  rollover) into a single 60s scheduler.
- Skip non-essential timers when hidden; run once on visibility change.
- Debounce the 44 `localStorage.setItem` call sites (esp. autosave).
- Replace 80ms long-press repeat interval with CSS/RFA approach.

## 2. Send to server side

- Push profile/config/PIN changes via SSE (kills 2 polling timers).
- Server-side date rollover (server broadcasts midnight reset via SSE).
- Merged-away tombstone refresh via SSE.
- Server-side profile name-link reconciliation (replace 60s `pass()` poll).
- Client auto-track becomes passive: server executes claims, client displays.

## 3. App quality

- Break up `home.tsx` (24.7K lines): sync engine, dialog management,
  packaging engine, run lifecycle (target <10K lines).
- Virtualize long lists (ingredients, recipes, schedule editor).
- Lazy-load inactive tab content via `React.lazy`.
- Optimistic writes with SSE-echo rollback.
- Profile caching (one-time load on login, SSE pushes afterward).

## 4. New business value

- **Food cost / cost-per-pizza module** — the data is all tracked (recipes,
  lbs, oz, batches) but cost is never computed. Ingredient unit cost →
  cost per pizza/batch/run + daily/weekly variance.
- **Scheduled manager digest** — daily/weekly AI recap pushed to managers'
  phones via the existing web-push infra (push is built but not wired to
  live app events).
- **Historical trend dashboard** — pizzas/day, batches/day, downtime by
  cause, waste value, yield % over 30/90 days.
- **AI cost guardrails UI** — manager-facing "AI usage this week" panel
  (requests, tokens, est $, per route). Metering already exists.

## 5. Offline & resilience

- **True offline-capable PWA** — verify + harden the offline edit → queue →
  sync-on-reconnect loop for factory WiFi dead zones.
- **Server-side nightly backup + export** — scoped JSON + Postgres dump to
  an artifact; one-click manager "export my data"; protects the whole
  recipe library on Render free tier.
- **Better cold start** on Render free tier (warm-up ping, cache expensive
  imports so first load after sleep is fast).

## 6. Day-to-day UX for supervisors

- Batch/skid quick-ref labels or scannable code to jump to a run.
- Role-based keyboard shortcuts (`N` new run, `S` stop, `U` undo tick,
  `1-6` tabs).
- Manager-only "restore state from 1 hour ago" snapshot rollback (coarse,
  only on drift detection — protects battery).

## 7. Self-testing / self-repairing

Already exists: boot self-checks (schema→roles→heals→listen + readyz),
fingerprinted data-repair registry (~16 repairs), master-data health
scan/repair endpoints, startup-failure rehearsal, schema-safe rollback
rehearsal, nightly large-spec harness, serverJobs with heartbeats.

Gaps worth building:

- **Daily off-peak repair sweep** — `runDataHeals()` only runs at boot;
  add a periodic re-run of master-data + sync-consistency checks that
  silently applies automatic repairs.
- **Runtime invariant sentinel** — read-only `/api/diagnostics/self-test`
  that runs the sync/state invariants (from the skills) against live rows
  and returns a pass/fail matrix.
- **Auto-track drift detection** — server recomputes expected counters and
  quarantines + alerts on drift beyond tolerance.
- **Client local-state self-repair on load** — full "local = server"
  reconciliation + one-tap "Repair local data".
- **System Health panel for managers** — self-test matrix, repair ledger,
  scan findings, "Run repair" button.
- **Scheduled AI corrections re-review** — nightly bounded replay of the
  day's AI responses against ground truth, flag accuracy drift.
- **Stuck-job / dead-client watchdog** — mark stuck server jobs failed;
  drop SSE clients that haven't acked in N minutes.
- **Watchdog restart with backoff** — retry failed startup stages, and
  after 3× failures emit a web push to managers instead of crash-looping.


## 8. Import system improvements

The import pipeline is already very strong (AI parse, learned aliases, chunk
retries, review-with-reconfirmation, corpus harness, junk-file guards, ~50
regression test files). These are gaps, not redo-items, focused on the empty-DB
first-import experience (where AI gets hit hardest) + ongoing cost.

### Throughput & cost
- **Parallel chunk parsing** — large imports parse chunks sequentially (one AI
  call per chunk; ~240 profiles ≈ 10-15 calls). Fire 2-3 chunks concurrently
  (bounded, still respects `aiCostLimit`), merge with existing
  `mergeParsedSpecImports`, keep per-chunk retry safety. Cuts ~10 min import
  to ~4-5 min.
- **Cache repeated imports by content fingerprint** — SHA-256 file fingerprint
  already exists; if a workbook is re-uploaded with a matching hash, reuse the
  prior parse instead of re-billing AI for identical data. Extend the existing
  snapshot/prune machinery to full parse reuse.
- **Diff-only re-import** — for re-imports that mostly match the DB, send only
  the CHANGED rows to AI instead of the whole sheet. The DB already knows what
  exists (`profileExistsForImport`, recipe pools); pre-filter client-side before
  the AI call. Biggest cost cut for ongoing updates.

### Correctness & confidence
- **Structured post-parse validation** — the reviewer-AI flags are mostly
  advisory. Add hard invariants (totals reconcile, required fields present, no
  duplicate names in parse, die types linkable) and auto-reject the chunk on
  hard-fail instead of showing a known-bad review.
- **Per-cell confidence in the review UI** — show where the AI was unsure
  (per-line confidence / flagged cells in the summary dialog) so the manager
  validates the risky 5% instead of eyeballing 100%.
- **Automated cross-checks vs source library corpus** — surface "matches N
  known aliases with high confidence" in review; flag "0 matches, unusual name"
  for a second look. Plumbing exists in `canonicalize`/`collectMatchCandidates`.

### UX & resilience
- **Resume-from-failure** — multi-file import failing at file 6/10 re-runs the
  whole import (re-billing files 1-5). Add per-file completion state + "Retry
  remaining (5)" without re-parsing completed files.
- **Import history with change audit** — extend `importHistory`/panel to record
  per-import review summary (new/updated/flagged counts) so a manager can audit
  what a past import did.
- **Background/queued imports** — run large imports as a `serverJobs` job with
  SSE progress; manager walks away and gets a web push when done.

### Safety
- **Import undo (rollback last committed import)** — snapshot prior values
  before commit and add manager-only "Undo last import" that restores prior
  profile fields, deletes newly created rows, restores aliases.
- **Per-import dry-run before commit** — show would-be state without writing
  (toggle "show what WOULD change" → commit) for confidence on big data
  cleansing imports.

## 9. Sync system improvements

The sync layer is already one of the app's strongest subsystems (additive
non-clobber merges, run-level edit stamps, tombstones, server-owned auto-track
claims with arbitration, reset epochs, partial snapshots, SSE + periodic push).
These target remaining blind spots, not the core design.

### Reliability & conflict visibility
- **Conflict ledger / "what merged" transparency** — record per-day, per-field
  merge outcomes ("Device A's skid count (12) superseded Device B's (11) at
  09:41"), surface in a sync diagnostics panel, keep N days in day-state.
  Makes silent LWW merges auditable; would have made lost-update bugs visible.
- **Field-level last-writer metadata** — extend `runValuesUpdatedAt` from
  per-run to per-field (or per-form-section) so a slow tablet edit can't
  clobber a fresher single-field edit on another device.
- **Sync health canary / convergence proof** — synthetic counter each device
  increments + pushes; server verifies merged value equals expected count.
  Catches silent divergence (dropped frames, tombstone races) early.
- **Peer device presence** — SSE knows connected `clientId`s; surface "3
  devices live: Warehouse tablet, Line 2, Manager phone" so a manager sees a
  silently-offline station without walking the floor.

### Bandwidth & payload
- **Delta/diff sync** — `schedulePush` uploads the whole day-state per edit
  push (10MB cap). Add delta mode: send only changed runs/values + stamps,
  keep full merge semantics (extend the `completeness: "partial"` contract to
  a first-class client push mode).
- **Compact wire format** — gzip'd JSON or msgpack behind a content-type flag
  for the periodic 30s push; benefit on tablet cellular connections.
- **Throttle no-op pushes** — dirty-check before the 30s periodic push so it
  only fires when stamps moved since last ack (bandwidth side of the battery
  idea).

### Offline & recovery
- **Offline queue with rich semantics** — per-operation retry discrimination:
  edits that can never merge (stale generation) surface a conflict-resolution
  screen instead of silently re-queueing until the next reset wipes them.
- **Snapshot restore for a dead tablet** — manager-initiated "push full
  snapshot to station X" (server-pushed full state) so a repaired device
  rejoins in seconds, not minutes.
- **Boot-time reset-epoch check** — verify epoch against server on open (cheap
  `/sync/today` already exists) so a device that was closed during the daily
  reset never starts on stale data.

### Maintainability
- **Sync contract versioning / schema registry** — explicit migrations registry
  + a test that forbids silent contract drift (mirror the OpenAPI/codegen
  lockstep pattern) as new fields land.
- **Per-channel backpressure** — priority queues per channel (manual edits >
  packaging > auto-track claims) so a burst of auto-track claims never delays a
  human's edit onto the wire.

## 10. Responsive design / visual quality

The app looks large on phones, small on tablets, and overlaps on phones
(can't read fully). Root causes found in the code:
- 567 fixed `text-[10px]/[11px]/[9px]` sizes tuned for desktop density
- 85+ `grid-cols-N` without responsive breakpoints (4 cols on 375px phone)
- 126 truncates hide field names on narrow screens
- Fixed `max-w-[180px]` inputs overflow phone dialogs
- `grid-cols-6` tab bar squeezes 6 tabs to ~62px each on phones

### Foundation: fluid scaling (highest impact)
- **Replace 567 fixed px font sizes with semantic scale + `clamp()` CSS.**
  Phone gets slightly smaller, tablet/desktop slightly larger; same relative
  density everywhere. Single biggest visual fix.
- **Global density rem scale** — set `html { font-size }` per breakpoint
  (`14px` phone, `16px` tablet, `17px` desktop) so everything scales as one
  unit; convert fixed px utilities to `em`/`rem`.
- **Fix every `grid-cols-N` without responsive prefix** — add
  `grid-cols-1 sm:grid-cols-N`. 85+ spots, mechanical, kills phone overlap.

### Layout correctness
- **Dialog inputs: `max-w-[180px]` → `min-w-0 w-full sm:max-w-[...]`** so
  inputs fill phone width, cap on tablet/desktop.
- **Dialogs: `max-h-[85dvh] sm:max-h-[90vh]`** so phone keyboard/notch
  never truncates content.
- **Tab bar: `grid-cols-6` → responsive scrollable strip or `4 + More`** on
  phones so labels are readable.
- **Reduce `truncate` on interactive labels** — use `whitespace-normal` +
  `line-clamp-2` where names need to be read.

### Device-specific polish
- **Viewport-safe areas on all fixed elements** (not just bottom tab bar):
  notch/Dynamic Island overlap in headers, dialogs.
- **Phone landscape compact mode** — horizontal keyboard-like density;
  no sideways scroll (568x320 already tested in e2e).
- **Touch targets: raise minimum to ~40px on phones** (Apple/Google HIG)
  so mis-taps on the floor go away.

### Tooling (keep it fixed)
- **Visual regression baseline at 375/768/1024/1440** — pinned screenshot
  diffs on main tabs via existing `test:e2e:visual` config. Breaks CI on
  visual regressions before they reach users.
- **Lint guard: "no new fixed px sizes"** — script that flags new
  `text-[NNpx]`/`w-[NNpx]` and requires a responsive alternative (like the
  existing `check-workbook-boundary` pattern).
