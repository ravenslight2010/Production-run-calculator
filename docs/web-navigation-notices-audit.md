# Web Navigation and Notices — Information Architecture Audit

## Scope and outcome

This is a **web-first, read-only audit** of the Production Run Calculator. It inventories the
navigation and user-facing notice surfaces in the current application so placement and copy can
be reviewed before any behavior changes are made.

**No navigation, notice, badge, preference, or alert behavior was changed as part of this
audit.**

### Terminology used below

- **Persistent** — remains until its underlying state changes or the user takes an explicit
  dismissal action.
- **Advisory** — asks for attention but does not prevent work.
- **Blocking** — prevents an action until the condition is resolved.
- **Capability-gated** — visibility or usefulness depends on the user role/capability. Server
  authorization remains the source of truth even where a client surface is visible.

---

## 1. Navigation inventory

### 1.1 Primary navigation

| Surface / label | Who sees it | When it is available | Expected action | Current location |
| --- | --- | --- | --- | --- |
| **Run** | All signed-in users | Always | Run, pause, stop, and monitor the current production run | Bottom tab 1 |
| **Dough** | All signed-in users | Always | Stage dough or crust supply and use mixer/batch timing | Bottom tab 2 |
| **Sauce** | All signed-in users | Always | Review and stage sauce requirements | Bottom tab 3 |
| **Front** | All signed-in users | Always | View frontline/applicator needs | Bottom tab 4 |
| **Pack** | All signed-in users | Always | Track packaging progress and completion | Bottom tab 5 |
| **Whse** | All signed-in users | Always | See warehouse pulls, staging, reorder, and stock guidance | Bottom tab 6 |

The bottom navigation is deliberately limited to six operational stations. The following
destinations are still tab panels in the web shell, but are reached through the overflow menu
instead of becoming additional bottom tabs: Stoppages, Summary, Stock/Inventory, Mixes, AI
Assistant, Setup, Incidents, Quality History, Downtime Trends, and Staff.

### 1.2 Header controls outside the overflow menu

| Surface | Who sees it | Trigger / state | Expected action | Current location |
| --- | --- | --- | --- | --- |
| Sync-status dot | All signed-in users | Always; color/status reflects sync state | Confirm whether the browser is connected | Header, left of action controls |
| **Saved** indicator | All signed-in users | Briefly after successful persistence | Reassurance only; no action | Header |
| **Cast to Screens** | All signed-in users | Always | Open display URLs/QR codes and optionally cast a station screen | Header |
| **Floor Mode** shortcut | Users with Floor Mode enabled | Preference is enabled | Open the simplified floor view | Header |
| Fullscreen toggle | All signed-in users | Always | Enter or leave fullscreen | Header |
| Role badge | All signed-in users | Always | Identify the current role/operator/supervisor context | Header |
| Overflow menu | All signed-in users | Always | Reach non-station destinations and account actions | Header |

### 1.3 Overflow-menu destinations

| Menu item | Who sees it | When it appears | Expected action | Current location |
| --- | --- | --- | --- | --- |
| Stoppages | All signed-in users | Always | Review or manage logged stoppages | Header menu → hidden panel |
| Summary | All signed-in users | Always | Review run/day summary | Header menu → hidden panel |
| Stock | All signed-in users | Always | Open the inventory editor/stock view | Header menu → `inventory` panel |
| AI Assistant | All signed-in users | Always | Ask operational questions or use available AI assistance | Header menu → `ai` panel |
| Mixes | All signed-in users | Always | View operational mix plan and make-day needs | Header menu → `mixes` panel |
| Report an issue | All signed-in users | Always | Submit a product/operational issue | Header menu → issue dialog |
| Reported issues | Managers (`manage-staff`) | Always for eligible role | Review and act on reported issues | Header menu → `incidents` panel |
| Quality history | Managers | Always for eligible role | Review quality history | Header menu → `quality` panel |
| Downtime trends | Managers | Always for eligible role | Review downtime trends | Header menu → `downtime` panel |
| Staff roster | Users who can manage staff or approve resets | Always for eligible capability | Manage staff or process password-reset approvals | Header menu → `staff` panel |
| Schedule | Supervisors | Always for eligible role | View or edit scheduled production days | Header menu → schedule dialog |
| Setup | All signed-in users | Always | Open line/recipe setup; edits are supervisor-gated | Header menu → `setup` panel |
| Alerts & Floor Mode | All signed-in users | Always | Set account notification preferences and Floor Mode preference | Header menu → dialog |
| Settings | All signed-in users | Always | Open **Manage Lists & Settings**; available tabs vary by capability | Header menu → dialog |
| Password | All signed-in users | Always | Change own password | Header menu → dialog |
| Get Started | All signed-in users | Always | Open product onboarding | Header menu |
| Mobile App | All signed-in users | Always | Open mobile-app information | Header menu |
| Guided Tour | All signed-in users | Always | Start/restart guided tour | Header menu |
| Reset sandbox | Sandbox users only | Sandbox environment only | Reset sandbox data after confirmation | Header menu |
| Sign out | All signed-in users | Always | End the session | Header menu |

### 1.4 Menu and header badges

| Badge | Who sees it | Trigger | Expected action | Current location |
| --- | --- | --- | --- | --- |
| Combined attention count | Staff-management-capable users | Pending password resets and/or unreviewed incidents | Open the relevant management destination and resolve the queue | Header / overflow-menu entry point |
| Reported issues count | Managers | Unreviewed incidents exist | Open **Reported issues** and review them | On Reported issues menu item |
| Staff roster count | Users who can manage staff or approve resets | Pending reset requests exist | Open **Staff roster** and approve/decline | On Staff roster menu item |
| Settings count | Eligible users | Attention-worthy manager/settings condition is present | Open Manage Lists & Settings and resolve the condition | On Settings menu item |
| Schedule count | Supervisors | Scheduled production days exist | Open Schedule and review upcoming work | On Schedule menu item |

### 1.5 Manage Lists & Settings dialog

This dialog is both a general settings destination and the home for factory master data. Its
section pills are assembled from the current user’s available tabs.

| Section / actions | Who sees or can use it | Expected action | Current location |
| --- | --- | --- | --- |
| Recipes: Dough, Sauce, Mixes, Cheese Recipes | Inventory-management-capable users for editor access | Create, edit, or delete shared recipe data | Settings → Recipes |
| Lists: Brands, Flavors, Pep Types, Applicator Types, Die Types | Users shown the Lists section; individual writes are server-authorized | Maintain selectable master lists, including rename/merge where offered | Settings → Lists |
| Ingredient Weights | Users shown the Lists section | Review/manage learned ingredient batch-weight data where controls are available | Settings → Lists |
| Shift Times | Users shown this settings tab | Configure shift timing | Settings → Settings |
| Production Rules | Users with `canEditRules` | Configure flexible or strict production rules | Settings → Settings |
| Die Defaults / Freezer Pull / Cycle Counts | Inventory-management-capable users | Configure factory operational defaults | Settings → Settings |
| Staff | Staff-management or password-reset-approval users | Manage staff, roles, and reset approval | Settings → Settings |
| Audit Log / AI Memory | Staff-management-capable users | Review audit entries or AI memory | Settings → Settings |
| Change PIN | Tab is visible broadly; writes are manager-authorized | Change/clear the supervisor PIN if permitted | Settings → Settings |
| Manage Runs | Supervisors | Remove not-started runs or sweep blank runs; active/completed runs stay read-only | Settings → Settings |
| Import | All signed-in users | Import supported workbook types | Settings → Tools |
| Setup Profiles | Supervisors | Open the standalone brand/flavor setup-profile editor | Settings → Tools |
| Merge | All signed-in users; result actions are authorized server-side | Consolidate duplicate ingredient, recipe, brand, or flavor names | Settings → Tools |

---

## 2. Notice and warning inventory

### 2.1 Application-wide and account notices

| Notice | Audience | Trigger | Expected action | Location / behavior |
| --- | --- | --- | --- | --- |
| Sandbox mode banner | Sandbox users | Current session is in a sandbox scope | Understand that data is isolated; reset only when intended | Persistent above tab content; advisory |
| Sync/write failure banner | All signed-in users | A day-state sync or inventory write failed | Reconnect/retry; do not assume other devices received changes | Persistent top-level banner; dismissible, but warns local changes are not backed up/shared |
| Proactive alert banner | Relevant shift users; often manager-facing correction | A proactive shift alert is available | Read the nudge; optionally **Apply** its proposed correction or **Dismiss** | Persistent top-level banner above tabs; advisory, one alert shown at a time |
| Alert preferences | All signed-in users | User opens Alert & Floor Mode | Toggle account-level browser/in-app alert preferences and Floor Mode | Header menu → dialog; not an operational warning |
| Browser permission state | All signed-in users | Notification permission is not granted/available | Grant permission if browser alerts are desired | Alert & Floor Mode dialog; preference/setup notice |
| Saved / sync status | All signed-in users | Ongoing connection and save state | Reassurance or connection awareness | Header; informational |

### 2.2 Run surface: safety, start-readiness, and pacing

| Notice | Audience | Trigger | Expected action | Location / behavior |
| --- | --- | --- | --- | --- |
| Allergen badge | Run users | Current run has a recognized allergen | Handle/run according to the displayed allergen status | Run Setup card; persistent informational warning |
| “Enter cases to enable calculations” | Setup-capable user editing a run | Target cases is zero | Enter planned cases | Run Setup card, directly under Target Cases; advisory |
| Strict production-rule violations | Operator/supervisor starting a run | Required strict checks are violated | Resolve/acknowledge the listed required setup issue before starting | Run / setup flow; **blocking** because Start Run is disabled |
| Flexible production-rule violations | Operator/supervisor | A flexible rule is violated | Review/correct when appropriate; start remains possible | Run / setup flow; advisory warning |
| Missing line setup banner | Active run user | Speed, cycle, pizzas-per-case, or line-time values needed for live calculations are absent | Enter missing line settings | Run surface near operational controls; advisory but calculation-critical |
| Auto-detected stall prompt | Active run user | Line appears behind with no stoppage logged | **Log stoppage** or **Dismiss** | Run surface; advisory, explicitly actionable/dismissible |
| Behind-pace alert | Active run user | Pace alert condition is reached | Investigate pace; **Dismiss** after acknowledging | Run surface; red advisory banner |
| Pace status / catch-up PPM | Active run user | Pace can be calculated | Adjust line pace as needed | Run KPI card; persistent, informational/advisory |
| Estimated-finish drift | Active run user | Projected finish moves materially from initial estimate | Use the changed finish estimate to plan staffing/hand-off | Run KPI card; advisory |
| Target reached | Active run user | Completed cases meet or exceed target | End or transition the run when operationally ready | Run completion KPI badge; informational |
| Run phase / freezer-draining status | Active run user | Product is filling, pausing, resuming, or draining through the line/freezer | Wait, prepare hand-off, or start the next run at the appropriate stage | Run status strip and ended-run status; informational |
| Run ended / line clear | Active run user | Run ended and all phases have cleared | Move to next run or close out | Run status area; informational |
| Run-complete and freezer-empty notifications | Users with corresponding preferences and browser support | Run timer completes or freezer drains | End/advance the run and prepare next work | Browser notification; advisory, system-dismissible |
| Die-change warning | Active/paused run user | Next scheduled run requires a different die | Plan the changeover before switching | Run surface; advisory |
| Warehouse switchover notice | Active run user | Current run is close enough to completion to stage the next run | Stage frontline/packaging for the next run | Run surface; advisory |
| Recipe substitution badge | Run users | Today’s substitutions affect one of the current run’s recipes/types | Verify the substitution is understood before using the recipe | Run/Dough context; persistent informational badge |

### 2.3 Dough, sauce, front, and packaging operational notices

| Notice | Audience | Trigger | Expected action | Location / behavior |
| --- | --- | --- | --- | --- |
| Manual auto-track override banner | Dough/packaging operator | User manually changes a tracked counter while auto-tracking suppression is active | **Resume now** to restore auto tracking, or wait for timed resume | Dough and packaging/run-adjacent surfaces; advisory, action is direct |
| Dough timers paused | Dough operator | Run/timers are paused or live timing is unavailable | Resume run/timers when appropriate | Dough timing/stepper context; advisory |
| Mixer cannot keep up | Dough operator | Measured mixer/hopper supply cadence is slower than line consumption | Adjust prep timing/capacity | Dough machine-times card; advisory |
| Line full — max 74 trays | Dough operator | Trays-on-line counter reaches maximum | Stop adding trays until the line consumes supply | Directly under tray stepper; advisory, self-clearing |
| Max 3 batches — avoid over-mixing | Dough operator | Ready-batch counter reaches maximum | Do not start another batch until supply falls | Directly under batch stepper; advisory, self-clearing |
| Next batch due / Start next dough batch now | Dough operator | Live batch cadence reaches upcoming/due boundary | Start the next batch | Dough surface; in-app countdown/banner, with optional clearing after action |
| Dough-batch browser notification | Users with preference and browser support | A new batch boundary is due | Start the next dough batch | Browser notification; advisory, system-dismissible |
| Packaging quick-check behind | Dough/packaging operator | Packed cases trail the expected count by more than the tolerance | Update packaging count or correct the packaging backlog | Dough surface’s cross-station quick check; advisory |
| Near-full skid indicator | Packaging operator | Cases on current skid are within three cases of its configured capacity | Prepare to close/start the next skid | Packaging cards; advisory |
| Sauce barrel nearly empty | Sauce operator | Sauce supply threshold is reached | Start a barrel / update sauce count | Sauce surface; advisory, closeable |
| Prep batch ready | Prep user | Prep/batch-ready state is reached | Act on readiness or dismiss after acknowledging | Prep/Dough context; advisory |
| Missing pizza/case setup for mix planning | Operator/manager viewing mix plan | Required pizza/case inputs are absent | Complete setup inputs | Mix-plan area; advisory |
| Missing mix oz/pizza amounts | Manager/operator viewing mix plan | A required mix component has no usable amount | Correct the mix or ask a manager | Mix-plan area; persistent until data is fixed |
| Mix has no batch size/components | Manager/operator viewing mix plan | Mix definition is incomplete | Complete the mix definition | Mix-plan area; persistent until data is fixed |

### 2.4 Warehouse and inventory notices

| Notice | Audience | Trigger | Expected action | Location / behavior |
| --- | --- | --- | --- | --- |
| Pull-for-run staging checklist | Warehouse operator | Current run has materials that should be staged | Check off each item as it is staged | Whse tab; operational checklist |
| Reorder Now | Warehouse users | Cross-location stock after scheduled demand is at/below a reorder threshold | Order the suggested quantity | Whse tab; advisory, read-only card |
| Use First | Warehouse users | A lot is expired or inside the configured expiry window | Use the displayed lot first, or remove/quarantine expired stock as appropriate | Whse tab; advisory, read-only card |
| Inventory Alerts: expired lots | Warehouse/inventory users | An on-hand lot is expired | Do not use it; correct/quarantine inventory | Stock/Inventory panel; persistent warning |
| Inventory Alerts: expiring lots | Warehouse/inventory users | An on-hand lot expires inside the configured window | Prioritize its use | Stock/Inventory panel; persistent warning |
| Inventory Alerts: low stock | Warehouse/inventory users | On-hand stock is at/below its reorder threshold | Reorder or use **Substitute** to stage a temporary substitution | Stock/Inventory panel; persistent warning with action |
| Transfer Needed | Warehouse users | Onsite/line inventory cannot cover the plan while another location can transfer stock | Move the stated stock from the named location | Stock/Inventory panel; persistent advisory |
| Inventory load/save error | Warehouse/inventory users | Inventory fetch or settings write fails | Retry or correct connection/settings | Stock/Inventory panel near inventory controls; persistent until next successful operation |
| Freezer-pull configuration error | Inventory-management-capable user | Freezer-pull item save/delete fails | Retry or correct connection | Manage Lists → Settings; inline error near form |
| Cycle-count configuration error | Inventory-management-capable user | Cycle-count save/delete fails | Retry or correct connection | Manage Lists → Settings; inline error near form |

### 2.5 Setup, recipes, scheduled work, and manager guidance

| Notice | Audience | Trigger | Expected action | Location / behavior |
| --- | --- | --- | --- | --- |
| Scheduled recipe setup warning | Managers | A future scheduled run lacks a profile or required recipe rows | Use **Set up** for each listed run | Scheduled Days area; persistent, advisory |
| Supervisor lock: Line Setup | Non-supervisors | User opens line settings without supervisor role | Ask a supervisor to edit; disabled controls cannot be used | Setup / Run line-settings surface; persistent role explanation |
| Supervisor lock: recipe settings | Non-supervisors | User opens recipe setup without supervisor role | Ask a supervisor to edit; disabled controls cannot be used | Setup recipes surface; persistent role explanation |
| Dough/sauce edited for this run only | Setup user; shared-update action only for inventory managers | Open run recipe differs from linked shared pool recipe | Continue as run-specific, or **Update shared recipe** if authorized | Setup recipe cards; advisory/actionable |
| Doughball variant choice | Setup user | Selected dough recipe has multiple matching variants and no automatic choice can be made | Pick a variant or choose **Not now** | Setup recipe card; advisory/actionable |
| Missing selected cheese recipe | Setup user | A selected cheese name no longer resolves to a shared recipe | Choose a valid blend or ask a manager to create it | Cheese picker; persistent setup warning |
| Per-run mix amount mismatch | Setup user | Mix slot oz/pizza and stored row totals conflict | Resolve by row sum or scaled total | Applicator mix card; advisory/actionable |
| Fill in Missing Data | Setup user; AI suggestions require manager | User scans and required values are blank | Review and individually apply/skip proposed values | Setup panel; explicit review workflow |
| Fill-missing AI error/note | User requesting AI help | AI cannot return suggestions, returns caveat, or is unavailable | Retry later or fill manually | Inside Fill in Missing Data; inline advisory |
| AI review badge: Double-check / Likely wrong | Setup user | An AI proposal carries a review concern | Review the value before applying it | Next to proposal; advisory |
| Run Insights suggestion | Managers | Completed-run history yields a setting recommendation | **Accept**, **Dismiss**, or later re-open a dismissed suggestion | Run surface; advisory, explicitly opt-in |
| Run Insights accept warning/error/follow-up | Managers | Applying suggestion may affect an unloaded profile, fails, or needs confirmation | Read warning, retry, or choose **Got it** | Inside Run Insights; inline |
| Production Rules manager warning/error | Rule editors | Invalid/strict rule state or a save/delete failure | Correct data/retry | Manage Lists → Settings; inline |
| Recipe, mix, freezer-pull, cycle-count, staff, password, and import form errors | The person using the relevant manager form | A request fails validation, authorization, or network persistence | Correct input, update permissions, or retry | Inline beside the source form; persistent until retry/success |

### 2.6 Destructive confirmations

Destructive actions use explicit confirmation dialogs rather than passive warnings. These include
deleting ingredients, recipes, brands/flavors, freezer-pull items, cycle-count schedules, staff
actions, imports/overwrites where applicable, merge operations, and sandbox reset. The expected
action is always to choose **Cancel** or an explicit destructive confirmation. These are
appropriately blocking and are intentionally kept at the point of the destructive action.

---

## 3. Action-toast inventory

Toasts are transient confirmations or recovery guidance. They should not be the sole location for
a task that must remain actionable later.

| Toast family | Exact current messages | Audience / trigger | Expected action |
| --- | --- | --- | --- |
| Import interruption and file read | “The screen restarted during your import”; “Couldn't read that file”; “Import canceled” | Any importer when a reload interrupts file picker/read, a file cannot be parsed, or a pending read is canceled | Re-select a file, correct the format, or retry in a stable browser tab |
| Recipe/master-data move | “Recipe moved”; “Old reference removed”; “Can't remove a real recipe here” | Manager/list editor moves or removes a recipe reference | Use Change History to undo a move; delete the actual recipe from its own section when directed |
| Batch/recipe propagation | “Batch weight saved”; “Cheese recipes updated”; “Run form updated”; shared dough/sauce recipe updated; “Couldn't update the shared recipe” | Manager saves shared recipe/batch changes or applies saved setup to an open run | Verify propagation; retry shared update if it failed |
| Import hygiene | “Possible duplicate ingredients”; “Import applied — mappings not remembered” | Import completes with possible duplicate ingredients or failed learned-alias persistence | Review duplicates later; reapply/check connection if mappings should be saved |
| Spec, premix, shipping, sauce, dough, and cheese imports | “Spec sheet imported”; “Premix sheet imported”; “Freezer-pull reminders not saved”; “Shipping guide imported”; “Sauce guide imported”; “Dough recipe guide imported”; “Cheese recipes imported” | Supported workbook import completes | Review results and fix anything called out in the detail text |
| Schedule import | “Signed out”; “Import complete”; “Import failed”; partial multi-day failure message | Schedule import cannot write, succeeds, or only partly succeeds | Sign in again, retry failed days, and inspect the schedule |
| Case-target propagation | “Run targets updated” | Approved target changes update in-progress runs | Verify updated targets |
| Cast | “Couldn't cast” | Cast request fails | Retry casting or use the copied screen URL/QR |
| Export | “Nothing to export”; “Export ready”; “Export failed” | User exports data | Download the workbook or correct/retry export |
| Session | “Signed out” | Session expiry blocks a protected operation | Sign in again and retry |

---

## 4. Findings and prioritized recommendations

These recommendations intentionally separate low-risk wording/placement adjustments from changes
that alter navigation, role behavior, information priority, or operational workflow.

### Priority 1 — safe copy or placement changes

These can be implemented without changing the underlying alert rules, permissions, or data flow.

1. **Label the two Mixes destinations by job, not by shared noun.**  
   The header’s **Mixes** is an operational make-day view, while Settings → Recipes → **Mixes**
   is master-data editing. Use labels such as **Mix Plan** and **Mix Recipes** (or add short
   descriptions under the existing labels). This removes a high-probability navigation ambiguity
   without moving either workflow.

2. **Make “Stock” and “Warehouse” terminology consistent.**  
   The bottom tab says **Whse**, the menu says **Stock**, and cast screens say **Warehouse**.
   Retain the six-tab structure, but use one user-facing term in menu, page heading, cast screen,
   and help copy—for example, **Warehouse & Stock** until a final term is chosen.

3. **Add one-line role explanations where a destination is visible but partly unavailable.**  
   The existing role-gate banners are good local explanations. Match that clarity in the Settings
   dialog: explain why a tab is absent/locked, especially when Lists are visible but recipe
   editors are not. Also change the broadly visible PIN tab to say that only managers can save a
   PIN before the user tries it.

4. **Standardize severity language in copy.**  
   Reserve “warning” for a condition that needs attention; call informational states “status” or
   “updating”; call a required start condition “required before start.” This is especially useful
   for strict rules, batch capacity limits, phase status, and low-priority AI notes.

5. **Give transient toasts a durable destination when they point to work that can wait.**  
   Keep success toasts transient, but add a small in-context link/button in the duplicate-import
   message path (for example, “Review duplicates”) rather than relying on the toast wording alone.
   This is a placement enhancement, not a behavior change.

6. **Clarify cross-station notices in their title.**  
   Rename the Dough-surface packaging notice to **Packaging quick check — no tab switch** and the
   warehouse switchover notice to **Stage next run**. The wording should identify the affected
   station before asking for action.

### Priority 2 — needs a product decision before implementation

1. **Define one manager attention model.**  
   Pending reset counts, incident counts, Settings counts, proactive alerts, and card-level
   errors all signal manager work. Decide whether the header should expose:
   - one unified **Manager attention** inbox with typed items, or
   - separate badges with a documented priority order and no combined count.

   This changes discoverability and potentially the operational management workflow, so it should
   be approved before implementation.

2. **Decide whether Setup is an operator destination or a supervisor configuration destination.**  
   Setup is visible to every signed-in user, but important editors are disabled for
   non-supervisors. The contextual per-run Setup jump is useful; the header destination can still
   be confusing. Product should decide between:
   - keeping it visible as read-only with an explicit “View setup” label,
   - renaming it to **Setup & Requirements**, or
   - limiting the menu entry while retaining contextual read-only information.

3. **Establish a notification priority and escalation policy.**  
   The same production event can appear as browser notification, in-app banner, metric/badge,
   and cross-station quick check. Decide which conditions deserve:
   - a browser notification,
   - a persistent in-app action banner,
   - a passive inline status only, or
   - no duplicate reminder.

   The immediate candidates are dough-batch reminders, behind pace, manual override, packaging
   lag, and run/freezer completion.

4. **Decide how to handle multiple proactive alerts.**  
   The top banner renders one proactive alert at a time. Decide whether hiding later alerts until
   the first is acted on is correct, or whether a queue/count and “next alert” behavior is needed.
   This affects alert semantics, not just layout.

5. **Choose a warehouse workflow boundary.**  
   Operational warehouse guidance is split between **Whse** (pulls, reorder, use-first) and
   **Stock** (inventory maintenance, low stock, transfers). Product should decide whether:
   - both remain separate but use clear task-based naming/descriptions, or
   - low-stock/transfer alerts should be surfaced as compact links in Whse while full editing
     remains in Stock.

6. **Decide whether manager configuration should remain one dialog.**  
   **Manage Lists & Settings** combines recipes, master lists, shift configuration, rules,
   staff, audit, imports, merge, and destructive operations. Splitting it into
   **Factory Setup**, **People & Security**, and **Data Tools** could improve findability, but
   it is a larger navigation and training change and needs product approval.

### Priority 3 — maintenance risk worth scheduling separately

1. **Consolidate the settings-navigation definitions.**  
   The dialog retains both legacy tab concepts and newer section/subtab construction. This is not
   currently a user-facing defect by itself, but it raises the chance that a menu item, badge, or
   capability rule will be added to one model and not the other.

2. **Document the web/mobile intentional differences per notice.**  
   This audit is web-first. Before moving notices, make a small parity matrix so a web placement
   improvement does not accidentally change a deliberately different mobile workflow.

---

## 5. Review checklist before any implementation

Before changing a menu or notice, review these decisions with product/operations:

1. Confirm the preferred terms for **Mix Plan / Mix Recipes** and **Warehouse / Stock**.
2. Choose the manager attention model and owner for each count/badge.
3. Approve a notification escalation policy for batch, pace, completion, and manual-override
   signals.
4. Decide whether global configuration remains a single dialog.
5. Identify which changes must preserve exact web/mobile placement parity and which are
   intentionally web-only.

Only after those choices are made should navigation or notice behavior be changed.