// Reviewed stable identities from the authoritative playwright.config.ts.
// Keep paths and title paths together so same-count substitutions are visible.
export const FULL_BROWSER_EXPECTED_CASE_IDENTITIES: readonly string[] = [
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › Android-sized PWA schedule editor exposes the break planner and preserves placements",
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › authenticated staff workflows expose accessible controls and dialogs",
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › authorized supervisors can save all break slots without manager-only controls",
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › manager break plans persist and operators can view placements without edit controls",
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › schedule calendar is labeled, keyboard operable, and free of obvious violations",
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › sign-in has labeled controls, keyboard navigation, and no obvious violations",
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › sign-in remains operable at 200% zoom",
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › stoppage and surplus labels pass contrast on operational backgrounds",
  "artifacts/run-calculator/e2e/accessibility-smoke.spec.ts :: accessibility smoke › supervisors can review field checks without physical-device attestation controls",
  "artifacts/run-calculator/e2e/ai-outage-reviewability.spec.ts :: keeps deterministic management workflows reviewable when enrichment is unavailable",
  "artifacts/run-calculator/e2e/audit-log-export.spec.ts :: exports the filtered audit PDF and safely retries rejected downloads",
  "artifacts/run-calculator/e2e/compact-run-strip.spec.ts :: CompactRunStrip — ended-run round-trip › strip stays visible with Ended status after Run-tab round-trip, no pause/resume buttons",
  "artifacts/run-calculator/e2e/critical-workflows.spec.ts :: completes manager-approved password recovery and fences the old session",
  "artifacts/run-calculator/e2e/critical-workflows.spec.ts :: repairs scoped Data Health findings, preserves started runs, and guards undo",
  "artifacts/run-calculator/e2e/cross-device-smoke.spec.ts :: staff lifecycle recovers across desktop and phone layouts",
  "artifacts/run-calculator/e2e/department-workflow-navigation.spec.ts :: manager can open the Dough recipe editor without an uncaught page error",
  "artifacts/run-calculator/e2e/department-workflow-navigation.spec.ts :: production, warehouse, QC, and management remain connected after navigation",
  "artifacts/run-calculator/e2e/die-tunnel-defaults.spec.ts :: run-form die tunnel defaults › fills 7-inch values, switches to 12-inch values, and preserves typed time",
  "artifacts/run-calculator/e2e/dough-correction-resume.spec.ts :: manager Dough corrections resume without a catch-up write",
  "artifacts/run-calculator/e2e/freezer-surplus.spec.ts :: confirms and applies dated surplus at desktop",
  "artifacts/run-calculator/e2e/freezer-surplus.spec.ts :: confirms and applies dated surplus at phone",
  "artifacts/run-calculator/e2e/home-navigation-reload.spec.ts :: Home navigation persistence › falls back to Run when the stored tab is invalid",
  "artifacts/run-calculator/e2e/home-navigation-reload.spec.ts :: Home navigation persistence › keeps the Inventory label after its supported menu path and reload",
  "artifacts/run-calculator/e2e/home-navigation-reload.spec.ts :: Home navigation persistence › keeps the Warehouse label on its direct screen after hydration and reload",
  "artifacts/run-calculator/e2e/home-navigation-reload.spec.ts :: Home navigation persistence › resets page scroll for a tab-backed More-menu destination",
  "artifacts/run-calculator/e2e/home-navigation-reload.spec.ts :: Home navigation persistence › restores a non-Run tab after reload",
  "artifacts/run-calculator/e2e/home-navigation-reload.spec.ts :: Home navigation persistence › unwinds tab history on browser back before leaving the app",
  "artifacts/run-calculator/e2e/live-sauce-dough-phone.spec.ts :: Dough and Sauce phone quick checks share line-speed feedback across tab switches",
  "artifacts/run-calculator/e2e/live-sauce-dough-phone.spec.ts :: Frontline App tracking survives off-tab work, corrections, pause, and reload",
  "artifacts/run-calculator/e2e/live-sauce-dough-phone.spec.ts :: Sauce and Dough live cards work at a phone viewport",
  "artifacts/run-calculator/e2e/live-sauce-dough-phone.spec.ts :: Sauce automatic supply stays accurate after the final partial unit",
  "artifacts/run-calculator/e2e/management-performance.spec.ts :: captures authenticated initial load and deferred staff visit budgets",
  "artifacts/run-calculator/e2e/management-performance.spec.ts :: keeps role-management controls unavailable to a non-manager on the staff roster",
  "artifacts/run-calculator/e2e/management-performance.spec.ts :: keeps signed-out cold and warm startup within the budget",
  "artifacts/run-calculator/e2e/management-performance.spec.ts :: keeps the first authenticated calculator visit usable on slow 3G @mobile-slow-network",
  "artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts :: keeps a completed sync merge in resolved review history",
  "artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts :: keeps a direct sync diagnostics link focused after reload",
  "artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts :: keeps a direct sync diagnostics panel focused after reload",
  "artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts :: loads the active view without hiding large queue history",
  "artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts :: opens a scoped sync queue item in the sync diagnostics workflow",
  "artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts :: opens an incident queue item in the matching incident review surface",
  "artifacts/run-calculator/e2e/manager-action-queue-stale.spec.ts :: shows a stale update error, then refreshes and safely retries",
  "artifacts/run-calculator/e2e/manager-attention.spec.ts :: live and setup profile recipe pickers keep the shared selector contract",
  "artifacts/run-calculator/e2e/manager-attention.spec.ts :: manager attention remains stable across dialog and destination transitions",
  "artifacts/run-calculator/e2e/manager-attention.spec.ts :: manager setup stays usable when recipe names are incomplete",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › 'already made' value persists after a page reload (saved to server)",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › 'need X lbs' badge on a regular mix card updates live when 'already made' is edited",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › 'need X lbs' badge updates immediately when 'already made' is edited",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › Pull For Mix per-component lbs on a regular mix card update live when 'already made' is edited",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › Pull For Prep includes a second run added while Mixes is open",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › Pull For Prep is reduced proportionally when some of the mix is already made",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › Pull For Prep is scaled proportionally when two runs share a prep ingredient and some is already made",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › Pull For Prep shows 0.00 lbs when the mix is fully covered by amountAlreadyMade",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › Pull For Prep updates live when already-made is edited and two runs share the prep ingredient",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › Pull For Prep updates live when the already-made field is edited in the UI",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › batch count on a regular mix card updates live when 'already made' is edited",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › batch count on cold load uses persisted amountAlreadyMade from the server",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › empty state is preserved after a page reload when all runs are ended",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › ending one run keeps the other run's mix card visible in a multi-run shift",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › manager can retry an already-made amount after the first save fails",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › mix card disappears from the plan after the run is marked ended",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › mix plan collapses to empty when all runs in a shift are ended",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › need 0.00 lbs badge appears on regular mix card when amountAlreadyMade >= totalLbs",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › need X lbs badge on regular mix card shows correct remaining amount",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card appears for a scheduled future-day run that lists its ingredient",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card appears when mix component uses comma-separator qualified name and run uses base name",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card appears when mix component uses paren-separator qualified name and run uses base name",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card appears when run ingredient uses slash-separator variant (e.g. 'Herb/Fresh')",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card appears when run ingredient uses comma-separator variant (e.g. 'Herb, Chopped')",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card appears when run ingredient uses paren-separator variant (e.g. 'Herb (Tidbits)')",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card appears when mix component uses slash-separator qualified name and run uses base name",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card appears when run uses a qualified ingredient name matching the mix component base name",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card is absent when no active run lists its component ingredient",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card shows correct per-run breakdown when two brands share an ingredient",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix card shows correct pull quantities when a run uses its ingredient",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix with daysEarly=0 is absent the day before the run and present on the run day",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › prep mix with daysEarly=1 appears on the run day and one day early but not two days before",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › retried already-made amount survives a later Mix Plan reload",
  "artifacts/run-calculator/e2e/mix-plan.spec.ts :: Mix Plan — prep card suppression and ended-run removal › shows the empty state on first Mixes visit after a cold reload with all runs ended",
  "artifacts/run-calculator/e2e/multi-device-convergence.spec.ts :: multi-device convergence › offline peer adopts the active edit after wake and reload",
  "artifacts/run-calculator/e2e/multi-device-convergence.spec.ts :: multi-device convergence › offline peer cannot resurrect a deleted run after reconnect and reload",
  "artifacts/run-calculator/e2e/multi-device-convergence.spec.ts :: multi-device convergence › reset epoch prevents an offline peer from re-adopting cleared state",
  "artifacts/run-calculator/e2e/multi-device-convergence.spec.ts :: multi-device convergence › simultaneous edits converge to one canonical value on both devices",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › Floor Mode remains opaque and closable at 1280x800",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › Floor Mode remains opaque and closable at 375x812",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › Floor Mode remains opaque and closable at 568x320",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › Floor Mode remains opaque and closable at 768x1024",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › authenticated calculator stays usable at 375x812",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › authenticated calculator stays usable at 390x844",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › failed sync keeps the retained-change retry action visible on phone",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › focused sign-in fields stay reachable when the virtual keyboard reduces the viewport",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › manager workflows stay usable in narrow landscape at 568x320",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › operational dialog actions remain reachable at 375x812",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › operational dialog actions remain reachable at 568x320",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › sign-in is usable without overflow at 375x812",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › sign-in is usable without overflow at 390x844",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › sign-in is usable without overflow in narrow landscape at 568x320",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › standalone setup editor actions remain reachable at 375x812",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › standalone setup editor actions remain reachable at 568x320",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › sync details stay fully visible from phone through desktop widths",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › tablet calculator stays readable at 1024x768",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › tablet calculator stays readable at 768x1024",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › tablet manager settings remain reachable at 1024x768",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › tablet manager settings remain reachable at 768x1024",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › touch selection dialogs on phone › opens schedule and recipe pickers without page scrolling",
  "artifacts/run-calculator/e2e/phone-layout.spec.ts :: phone layout smoke › touch selection dialogs on tablet › opens schedule and recipe pickers without page scrolling",
  "artifacts/run-calculator/e2e/photo-count.spec.ts :: completes the manager photo-count review on desktop and phone",
  "artifacts/run-calculator/e2e/photo-spec-import.spec.ts :: applies a photographed sauce review edit to the authenticated sauce recipe pool",
  "artifacts/run-calculator/e2e/photo-spec-import.spec.ts :: applies photographed review edits to the authenticated profile and recipe pools",
  "artifacts/run-calculator/e2e/photo-spec-import.spec.ts :: keeps photographed pages editable and canceling review leaves master data unchanged",
  "artifacts/run-calculator/e2e/photo-spec-import.spec.ts :: persists every ingredient from a photographed multi-ingredient cheese recipe",
  "artifacts/run-calculator/e2e/photo-spec-import.spec.ts :: persists every ingredient from a photographed multi-ingredient dough recipe",
  "artifacts/run-calculator/e2e/prior-run-drain.spec.ts :: keeps the prior-run drain selected through next-run and tab changes",
  "artifacts/run-calculator/e2e/profile-subtab-reload.spec.ts :: adopts crust preference, reloads, and starts a new run in crust mode",
  "artifacts/run-calculator/e2e/profile-subtab-reload.spec.ts :: keeps the saved crust preference after sign-out and a fresh browser session",
  "artifacts/run-calculator/e2e/pwa-handoff.spec.ts :: PWA update handoff › auto-reloads when Home was already safe before update discovery",
  "artifacts/run-calculator/e2e/pwa-handoff.spec.ts :: PWA update handoff › preserves unsafe work, then auto-reloads after safe inactivity",
  "artifacts/run-calculator/e2e/pwa-handoff.spec.ts :: PWA update handoff › recovers an old HTML-served Home chunk onto the current build once",
  "artifacts/run-calculator/e2e/pwa-morning-login.spec.ts :: keeps one morning sign-in authenticated through stale-day rollover",
  "artifacts/run-calculator/e2e/pwa-morning-login.spec.ts :: resumes the cookie session after an Android-style PWA close and reopen",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: a delayed learned batch weight reaches future pending runs but preserves started and paused snapshots",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: cheese recipe edits refresh pending runs across browsers but freeze after Start",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: dough recipe edits refresh pending runs across browsers but freeze after Start",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: dough recipe refresh stays with its original run after a rapid switch",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: manager weight edits acknowledge, propagate, clear, and remain retryable across devices",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: mix recipe edits refresh pending runs across browsers but freeze after Start",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: mix recipe refresh stays with its original run after a rapid switch",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: remembered non-default pepperoni batch weights rehydrate in a peer without changing default sticks",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: remembered plain ingredient batch weights survive a fresh sign-in",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: sauce recipe edits refresh pending runs across browsers but freeze after Start",
  "artifacts/run-calculator/e2e/recipe-refresh-start-freeze.spec.ts :: sauce recipe refresh stays with its original run after a rapid switch",
  "artifacts/run-calculator/e2e/run-insights.spec.ts :: Run Insights — accept, dismiss, follow-up › Accept changes cycleSpeed in the saved profile and shows confirmation",
  "artifacts/run-calculator/e2e/run-insights.spec.ts :: Run Insights — accept, dismiss, follow-up › Dismiss suppresses the suggestion and it stays suppressed on same drift",
  "artifacts/run-calculator/e2e/run-insights.spec.ts :: Run Insights — accept, dismiss, follow-up › Follow-up note appears after next run and is cleared by Got-it",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › A. running run: counter jumps by full 50-case delta in one wake tick (no cap)",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › B. paused run: counter stays frozen after screen-off + wake",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › C. disconnected sleeping peer adopts remote Stop before stale recovery writes and after reload",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › D. active peers and server keep a downward skid correction over a stale automatic write",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › D. pause, background sleep, and resume keep all live countdowns aligned",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › E. one device keeps a paired Packaging correction through wake and reload",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › F. a failed Packaging correction stays visible on phone until an explicit retry",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › keeps cases-on-line occupancy frozen across reload while paused",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › offline wake waits for reconnect acknowledgement before sending tray and batch claims",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › preserves cases-on-line occupancy across reload while the freezer drains",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › responsive display matches shared line occupancy while running, paused, and draining",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › speed adjustment during a dough run stays aligned across screen wake",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › two live sessions converge through visible retry after an offline wake",
  "artifacts/run-calculator/e2e/screen-off-wake.spec.ts :: screen-off / wake — case counter lifecycle › wake recovery queues one Stop tap and applies it to the same run",
  "artifacts/run-calculator/e2e/spec-import-unit-provenance.spec.ts :: shows recipe unit provenance without rescaling workbook values or blocking Apply",
  "artifacts/run-calculator/e2e/station-handoff-responsive.spec.ts :: Summary card keeps an uncommitted note focused across a live timer tick",
  "artifacts/run-calculator/e2e/station-handoff-responsive.spec.ts :: keeps Frontline and Packaging handoffs selected once on a phone-sized viewport",
  "artifacts/run-calculator/e2e/sync-convergence.spec.ts :: exhausted sync failure retains the change for a manual retry",
  "artifacts/run-calculator/e2e/sync-convergence.spec.ts :: keeps the future source available with retry guidance when the destination write fails",
  "artifacts/run-calculator/e2e/sync-convergence.spec.ts :: manager moves a future run into a populated today plan and keeps it after reload",
  "artifacts/run-calculator/e2e/sync-convergence.spec.ts :: offline device adopts active deletion, survives reload, and never resurrects the run",
  "artifacts/run-calculator/e2e/sync-convergence.spec.ts :: queued Target Cases edit recovers when a sleeping tab wakes",
  "artifacts/run-calculator/e2e/sync-convergence.spec.ts :: retries source cleanup after a successful destination write without duplicating today's run",
  "artifacts/run-calculator/e2e/sync-convergence.spec.ts :: temporarily failed sync write retries automatically after the network recovers",
  "artifacts/run-calculator/e2e/sync-convergence.spec.ts :: wake enforces reset epoch and client-date scope while unchanged writes stay no-op",
  "artifacts/run-calculator/e2e/sync-diagnostics-download.spec.ts :: downloads a date-scoped sync diagnostic JSON report",
  "artifacts/run-calculator/e2e/sync-diagnostics-download.spec.ts :: filters older local sync diagnostics from the downloaded report",
  "artifacts/run-calculator/e2e/sync-diagnostics-download.spec.ts :: keeps the diagnostic report on the active date across local midnight",
  "artifacts/run-calculator/e2e/visual-regression.spec.ts :: intentional visual regression baselines › desktop production states: live run, Mix Plan, import review, and alert dialog",
  "artifacts/run-calculator/e2e/visual-regression.spec.ts :: intentional visual regression baselines › phone compact presentation and stop dialog",
  "artifacts/run-calculator/e2e/visual-regression.spec.ts :: intentional visual regression baselines › tablet portrait and landscape compact presentation",
  "artifacts/run-calculator/e2e/warehouse-coverage.spec.ts :: explains restricted inventory actions to non-managers",
  "artifacts/run-calculator/e2e/warehouse-coverage.spec.ts :: keeps capped offsite transfer guidance readable on a phone",
  "artifacts/run-calculator/e2e/warehouse-coverage.spec.ts :: keeps capped offsite transfer guidance readable on a tablet",
  "artifacts/run-calculator/e2e/warehouse-coverage.spec.ts :: shows capped offsite transfer guidance and hides it when onsite stock covers demand",
  "artifacts/run-calculator/e2e/warehouse-coverage.spec.ts :: shows the Warehouse switchover handoff through real tab navigation",
];

export const FULL_BROWSER_EXPECTED_CASES =
  FULL_BROWSER_EXPECTED_CASE_IDENTITIES.length;

export const FULL_BROWSER_EXCLUDED_CASE_PATTERN =
  /@focused-only|@real-mobile-browser (?:physical Android Chrome|queued Target Cases edit (?:recovers after Android Chrome suspension|survives an Android Chrome process restart))/;

export function assertFullBrowserCaseContract(discoveredCases: number): void {
  if (discoveredCases === FULL_BROWSER_EXPECTED_CASES) return;

  throw new Error(
    `Full browser release lane discovered ${discoveredCases} cases; expected exactly ${FULL_BROWSER_EXPECTED_CASES}. Update the full-browser case contract or release filter before running evidence.`,
  );
}

export function assertFullBrowserCaseIdentityContract(
  discoveredIdentities: readonly string[],
): void {
  const expected = new Set(FULL_BROWSER_EXPECTED_CASE_IDENTITIES);
  const discovered = new Set(discoveredIdentities);
  const added = [...discovered].filter((identity) => !expected.has(identity));
  const removed = [...expected].filter((identity) => !discovered.has(identity));
  const duplicateCount = discoveredIdentities.length - discovered.size;

  if (added.length === 0 && removed.length === 0 && duplicateCount === 0) {
    return;
  }

  const details = [
    `Full browser Chromium case identities differ from the reviewed inventory (${FULL_BROWSER_EXPECTED_CASE_IDENTITIES.length} expected, ${discoveredIdentities.length} discovered).`,
  ];
  if (added.length > 0) {
    details.push("Added identities (review before updating the inventory):");
    details.push(...added.sort().map((identity) => `  + ${identity}`));
  }
  if (removed.length > 0) {
    details.push("Removed identities (review before updating the inventory):");
    details.push(...removed.sort().map((identity) => `  - ${identity}`));
  }
  if (duplicateCount > 0) {
    details.push(`Duplicate discovered identities: ${duplicateCount}`);
  }

  throw new Error(details.join("\n"));
}