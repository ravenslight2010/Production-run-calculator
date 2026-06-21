// Shared voice-command contract for the run-calculator web + mobile apps.
//
// A spoken phrase on the assistant mic is classified server-side as either a
// QUESTION (handled by the existing /ai/ask flow, unchanged) or a COMMAND. A
// command is returned as one or more structured actions drawn from the fixed
// vocabulary below, with every fuzzy reference (a run by brand/flavor, an
// inventory item by name) already resolved to a concrete id/key server-side and
// a friendly `label` attached.
//
// This module is pure TypeScript (no platform deps) so all three packages share
// ONE source of truth:
//   - the API server emits exactly these action shapes,
//   - both clients dispatch them through `dispatchVoiceCommand`, which maps each
//     action kind to a platform handler and enforces role gating identically.
//
// There is intentionally NO new mutation logic here: a handler simply forwards
// to the app's existing run/inventory mutation, and returns an `undo` so a
// misheard command can be reverted (Undo is the safety net — there is no
// confirm step).

// The downtime categories the apps already track. Web stores a free-text reason
// (its Stoppage.type is internal); mobile requires one of these. The server
// always emits both a normalized `stoppageType` and the spoken `reason`.
export type StoppageKind = "jam" | "changeover" | "break" | "other";

// The full, fixed command vocabulary. Each kind maps 1:1 to an existing app
// mutation. Adding a kind here is a deliberate, parity-affecting change.
export type VoiceCommandAction =
  | { kind: "set_target_time"; label: string; time: string }
  | { kind: "clear_target_time"; label: string }
  | { kind: "set_run_target"; label: string; runId: string; casesNeeded: number }
  | { kind: "reorder_run"; label: string; runId: string; beforeRunId: string | null }
  | { kind: "add_run"; label: string; brand: string; flavor: string }
  | { kind: "remove_run"; label: string; runId: string }
  | { kind: "switch_run"; label: string; runId: string }
  | { kind: "update_run_meta"; label: string; runId: string; brand?: string; flavor?: string }
  | { kind: "finish_run"; label: string; runId: string }
  | {
      kind: "start_stoppage";
      label: string;
      runId?: string;
      reason: string;
      stoppageType: StoppageKind;
    }
  | { kind: "end_stoppage"; label: string; runId?: string }
  | {
      kind: "set_run_progress";
      label: string;
      runId: string;
      skidsCompleted?: number;
      casesOnCurrentSkid?: number;
      casesPerSkid?: number;
    }
  | { kind: "log_actual_cases"; label: string; runId: string; actualCases: number }
  | { kind: "log_waste"; label: string; runId: string; wasteLbs: number }
  | {
      kind: "restock_item";
      label: string;
      itemKey: string;
      category: string;
      name: string;
      unit: string;
      qty: number;
    }
  | { kind: "adjust_item"; label: string; itemId: number; qtyDelta: number; note?: string }
  | { kind: "rollover"; label: string };

export type VoiceCommandKind = VoiceCommandAction["kind"];

// Every command kind, useful for prompt construction and validation.
export const VOICE_COMMAND_KINDS: readonly VoiceCommandKind[] = [
  "set_target_time",
  "clear_target_time",
  "set_run_target",
  "reorder_run",
  "add_run",
  "remove_run",
  "switch_run",
  "update_run_meta",
  "finish_run",
  "start_stoppage",
  "end_stoppage",
  "set_run_progress",
  "log_actual_cases",
  "log_waste",
  "restock_item",
  "adjust_item",
  "rollover",
];

export const STOPPAGE_KINDS: readonly StoppageKind[] = ["jam", "changeover", "break", "other"];

// Role required to execute each command, mirroring how the same manual action is
// gated in the UI / on the server. A command is honored only when the caller's
// role meets this bar — exactly as if they had performed it by hand. Every kind
// in the current vocabulary maps to an action available to any signed-in
// operator (inventory restock/adjust are server-gated at "operator", which
// admits everyone; the manager-only inventory paths — creating/deleting items —
// are deliberately NOT exposed as voice commands). The map is the single place
// to raise a kind to "manager" should a manager-only action ever be added.
export const VOICE_COMMAND_ROLES: Record<VoiceCommandKind, "operator" | "manager"> = {
  set_target_time: "operator",
  clear_target_time: "operator",
  set_run_target: "operator",
  reorder_run: "operator",
  add_run: "operator",
  remove_run: "operator",
  switch_run: "operator",
  update_run_meta: "operator",
  finish_run: "operator",
  start_stoppage: "operator",
  end_stoppage: "operator",
  set_run_progress: "operator",
  log_actual_cases: "operator",
  log_waste: "operator",
  restock_item: "operator",
  adjust_item: "operator",
  // Rolling the day over closes out every run, archives the day to history, and
  // resets to a fresh next day. It is irreversible (no Undo) and pushes a new
  // server-side session boundary that signs other devices out, so — unlike the
  // run-level commands above — it is gated to managers, matching how destructive
  // factory-wide actions are restricted in the UI.
  rollover: "manager",
};

// What the server returns for a single utterance: route it to the unchanged ask
// flow, run it as commands, or report that nothing actionable was understood.
export type VoiceCommandResponse =
  | { type: "question" }
  | { type: "command"; actions: VoiceCommandAction[] }
  | { type: "none"; note?: string };

// The result of one handler invocation. `undo` (when present) reverts the change
// within the client's short Undo window.
export type VoiceCommandOutcome = {
  ok: boolean;
  message: string;
  undo?: () => void | Promise<void>;
};

// The platform-supplied handlers. Each must forward to the app's EXISTING
// mutation (no new write surface) and return an outcome with an optional undo.
// Inventory handlers hit the network, so they may be async.
export interface VoiceCommandHandlers {
  setTargetTime(time: string): VoiceCommandOutcome;
  clearTargetTime(): VoiceCommandOutcome;
  setRunTarget(runId: string, casesNeeded: number): VoiceCommandOutcome;
  reorderRun(runId: string, beforeRunId: string | null): VoiceCommandOutcome;
  addRun(brand: string, flavor: string): VoiceCommandOutcome;
  removeRun(runId: string): VoiceCommandOutcome;
  switchRun(runId: string): VoiceCommandOutcome;
  updateRunMeta(
    runId: string,
    brand: string | undefined,
    flavor: string | undefined,
  ): VoiceCommandOutcome;
  finishRun(runId: string): VoiceCommandOutcome;
  startStoppage(
    runId: string | undefined,
    reason: string,
    stoppageType: StoppageKind,
  ): VoiceCommandOutcome;
  endStoppage(runId: string | undefined): VoiceCommandOutcome;
  setRunProgress(
    runId: string,
    progress: { skidsCompleted?: number; casesOnCurrentSkid?: number; casesPerSkid?: number },
  ): VoiceCommandOutcome;
  logActualCases(runId: string, actualCases: number): VoiceCommandOutcome;
  logWaste(runId: string, wasteLbs: number): VoiceCommandOutcome;
  restockItem(body: {
    itemKey: string;
    category: string;
    name: string;
    unit: string;
    qty: number;
  }): Promise<VoiceCommandOutcome> | VoiceCommandOutcome;
  adjustItem(body: {
    itemId: number;
    qtyDelta: number;
    note?: string;
  }): Promise<VoiceCommandOutcome> | VoiceCommandOutcome;
  // Close out the current day and reset to a fresh next day, reusing the app's
  // existing daily-rollover path. Irreversible — the returned outcome has no
  // undo. May be async on platforms whose rollover awaits a state flush.
  rollover(): Promise<VoiceCommandOutcome> | VoiceCommandOutcome;
}

// A dispatched command result, carried back to the UI to render a short
// confirmation (and an Undo button while `undo` is live).
export type VoiceCommandResult = {
  kind: VoiceCommandKind;
  label: string;
  ok: boolean;
  message: string;
  undo?: () => void | Promise<void>;
};

// The single, parity-critical mapping from an action kind to its handler. Both
// platforms call this with their own handler implementations, so the wiring
// (which handler, which arguments) can never drift between web and mobile.
function runAction(
  action: VoiceCommandAction,
  h: VoiceCommandHandlers,
): VoiceCommandOutcome | Promise<VoiceCommandOutcome> {
  switch (action.kind) {
    case "set_target_time":
      return h.setTargetTime(action.time);
    case "clear_target_time":
      return h.clearTargetTime();
    case "set_run_target":
      return h.setRunTarget(action.runId, action.casesNeeded);
    case "reorder_run":
      return h.reorderRun(action.runId, action.beforeRunId);
    case "add_run":
      return h.addRun(action.brand, action.flavor);
    case "remove_run":
      return h.removeRun(action.runId);
    case "switch_run":
      return h.switchRun(action.runId);
    case "update_run_meta":
      return h.updateRunMeta(action.runId, action.brand, action.flavor);
    case "finish_run":
      return h.finishRun(action.runId);
    case "start_stoppage":
      return h.startStoppage(action.runId, action.reason, action.stoppageType);
    case "end_stoppage":
      return h.endStoppage(action.runId);
    case "set_run_progress":
      return h.setRunProgress(action.runId, {
        skidsCompleted: action.skidsCompleted,
        casesOnCurrentSkid: action.casesOnCurrentSkid,
        casesPerSkid: action.casesPerSkid,
      });
    case "log_actual_cases":
      return h.logActualCases(action.runId, action.actualCases);
    case "log_waste":
      return h.logWaste(action.runId, action.wasteLbs);
    case "restock_item":
      return h.restockItem({
        itemKey: action.itemKey,
        category: action.category,
        name: action.name,
        unit: action.unit,
        qty: action.qty,
      });
    case "adjust_item":
      return h.adjustItem({
        itemId: action.itemId,
        qtyDelta: action.qtyDelta,
        note: action.note,
      });
    case "rollover":
      return h.rollover();
  }
}

// Execute a list of resolved command actions in order, enforcing role gating per
// action and never letting one failure abort the rest. Returns a result per
// action (in order) for the UI to confirm + offer Undo. A command the caller is
// not allowed to run is reported as a failed result rather than silently
// skipped, so the worker gets clear feedback.
export async function dispatchVoiceCommand(
  actions: VoiceCommandAction[],
  handlers: VoiceCommandHandlers,
  isManager: boolean,
): Promise<VoiceCommandResult[]> {
  const results: VoiceCommandResult[] = [];
  for (const action of actions) {
    const required = VOICE_COMMAND_ROLES[action.kind];
    if (required === "manager" && !isManager) {
      results.push({
        kind: action.kind,
        label: action.label,
        ok: false,
        message: "That action needs a manager.",
      });
      continue;
    }
    let outcome: VoiceCommandOutcome;
    try {
      outcome = await runAction(action, handlers);
    } catch (err) {
      outcome = {
        ok: false,
        message: err instanceof Error && err.message ? err.message : "Couldn't apply that.",
      };
    }
    results.push({ kind: action.kind, label: action.label, ...outcome });
  }
  return results;
}
