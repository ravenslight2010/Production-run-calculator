import { AiCommandBody } from "@workspace/api-zod";
import * as z from "zod";
import {
  STOPPAGE_KINDS,
  type StoppageKind,
  type VoiceCommandAction,
  type VoiceCommandResponse,
} from "@workspace/voice-commands";
import { validateOptimizeBody, type OptimizeInput } from "./aiOptimize";

// Bounds for the voice-command endpoint, in the same spirit as the optimize/ask
// guards: cap how much the model reads and how many actions one utterance can
// produce so a single misfire can't fan out into a flood of mutations.
export const MAX_UTTERANCE_CHARS = 600;
export const MAX_COMMAND_ACTIONS = 8;
export const MAX_LABEL_CHARS = 100;
export const MAX_NAME_CHARS = 120;
export const MAX_NOTE_CHARS = 400;
// Generous upper bounds, mirroring the optimize action guards, so the model
// can't emit absurd values that would commit through a one-tap (here, one-word)
// action with no confirm step.
export const MAX_TARGET_CASES = 1_000_000;
export const MAX_QTY = 10_000_000;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type CommandInput = z.infer<typeof AiCommandBody>;

export type CommandValidationResult =
  | { ok: true; data: { utterance: string; dayState: OptimizeInput } }
  | { ok: false; status: number; error: string };

// The grounding the server resolves fuzzy references against. Runs come from the
// supplied day-state (the same OptimizeInput /ai/ask uses); inventory comes from
// the live DB. The maps let us validate every model-proposed id/key and build
// friendly confirmation labels from real names.
export type CommandGrounding = {
  runs: Map<string, { label: string; brand: string; flavor: string }>;
  inventoryByKey: Map<string, { id: number; category: string; name: string; unit: string }>;
  inventoryById: Map<number, { key: string; name: string; unit: string }>;
};

// Validate POST /ai/command. The body carries a single spoken utterance plus the
// full live day-state (reusing OptimizeInput), so validate the envelope with the
// generated schema and reuse the optimize run-count cap on the nested day-state.
export function validateCommandBody(body: unknown): CommandValidationResult {
  const parsed = AiCommandBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message };
  }
  const utterance = parsed.data.utterance.trim();
  if (!utterance) {
    return { ok: false, status: 400, error: "Utterance is required" };
  }
  if (utterance.length > MAX_UTTERANCE_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Utterance too long (max ${MAX_UTTERANCE_CHARS} characters)`,
    };
  }
  const dayValidation = validateOptimizeBody(parsed.data.dayState);
  if (!dayValidation.ok) {
    return { ok: false, status: dayValidation.status, error: dayValidation.error };
  }
  return { ok: true, data: { utterance, dayState: dayValidation.data } };
}

function clamp(s: string, max: number): string {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

// Normalize the model's free-text stoppage category into the fixed set both
// apps share. Web stores a free-text reason (its internal Stoppage.type is not
// surfaced); mobile requires one of these four, so we always emit a concrete
// kind plus the spoken reason.
function normalizeStoppageKind(raw: string | undefined, reason: string): StoppageKind {
  const k = (raw ?? "").trim().toLowerCase();
  if ((STOPPAGE_KINDS as readonly string[]).includes(k)) return k as StoppageKind;
  const hay = `${k} ${reason}`.toLowerCase();
  if (/\b(jam|jammed|stuck|clog)/.test(hay)) return "jam";
  if (/\b(changeover|change\s?over|switch|swap|die)/.test(hay)) return "changeover";
  if (/\b(break|lunch|meal|rest)/.test(hay)) return "break";
  return "other";
}

// Build a compact, model-friendly prompt: the day's runs (with ids + brand and
// flavor so the model can resolve "the pepperoni run" → an id), the live
// inventory (with keys + ids + names), the current time, and the fixed command
// vocabulary. The model classifies the utterance and resolves every fuzzy
// reference to a concrete id/key drawn ONLY from the lists below.
export function buildCommandPrompt(
  input: CommandInput,
  inventory: Array<{ key: string; id: number; category: string; name: string; unit: string; onHand: number }>,
): { system: string; user: string } {
  const day = input.dayState;

  const system =
    "You are the command interpreter for a frozen-pizza factory production app used " +
    "by floor staff. A worker speaks a single phrase. Decide whether it is a QUESTION " +
    "(they want information) or a COMMAND (they want to change something in the app). " +
    "For a QUESTION, return {\"type\":\"question\"} and nothing else — a separate system " +
    "answers questions. For a COMMAND, return {\"type\":\"command\",\"actions\":[...]} using " +
    "ONLY the operations listed below, resolving every run/item reference to a concrete " +
    "id or key taken EXACTLY from the data provided. If you cannot map the phrase to a " +
    "listed operation, or a referenced run/item is not in the data, return " +
    "{\"type\":\"none\",\"note\":\"...\"} with a brief reason. NEVER invent ids, keys, runs, " +
    "or items. NEVER guess at an ambiguous reference — return none and say it was unclear.";

  const now = new Date(day.nowMs);
  const nowClock = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  const fmtRun = (r: OptimizeInput["runs"][number]): string =>
    `- id=${r.id} label="${r.label}" brand="${r.brand}" flavor="${r.flavor}" status=${r.status} die=${r.dieType || "?"} casesNeeded=${r.casesNeeded} casesMade=${r.casesMade}`;

  const lines: string[] = [];
  lines.push("DATA (the only ids/keys you may reference):");
  lines.push(`DATE: ${day.date}`);
  lines.push(`CURRENT TIME: ${nowClock}`);
  if (day.runToTime) lines.push(`CURRENT TARGET FINISH TIME: ${day.runToTime}`);
  lines.push("");
  lines.push("TODAY'S RUNS:");
  lines.push(day.runs.length ? day.runs.map(fmtRun).join("\n") : "(none)");
  lines.push("");
  lines.push("INVENTORY ITEMS:");
  lines.push(
    inventory.length
      ? inventory
          .map(
            (i) =>
              `- key=${i.key} id=${i.id} name="${i.name}" category=${i.category} unit=${i.unit} onHand=${i.onHand}`,
          )
          .join("\n")
      : "(none)",
  );
  lines.push("");
  lines.push(`UTTERANCE: ${input.utterance}`);
  lines.push("");
  lines.push(
    "Return ONLY JSON, exactly one of: " +
      '{"type":"question"} | {"type":"command","actions":[Action,...]} | {"type":"none","note":string}. ' +
      `Provide at most ${MAX_COMMAND_ACTIONS} actions. Each Action is one of:`,
  );
  lines.push(
    '- {"kind":"set_target_time","time":"HH:MM"} — set the shift target finish time.\n' +
      '- {"kind":"clear_target_time"} — clear the shift target finish time.\n' +
      '- {"kind":"set_run_target","runId":string,"casesNeeded":number} — change a run\'s case target.\n' +
      '- {"kind":"reorder_run","runId":string,"beforeRunId":string|null} — move runId before beforeRunId (null = last).\n' +
      '- {"kind":"add_run","brand":string,"flavor":string} — add a new run for a brand + flavor.\n' +
      '- {"kind":"remove_run","runId":string} — remove a not-yet-started run.\n' +
      '- {"kind":"switch_run","runId":string} — make a run the active/current run.\n' +
      '- {"kind":"update_run_meta","runId":string,"brand":string?,"flavor":string?} — rename a run\'s brand/flavor.\n' +
      '- {"kind":"finish_run","runId":string} — mark a run finished/ended.\n' +
      '- {"kind":"start_stoppage","runId":string?,"reason":string,"stoppageType":"jam"|"changeover"|"break"|"other"} — start a downtime/stoppage (omit runId for the current run).\n' +
      '- {"kind":"end_stoppage","runId":string?} — end the active stoppage (omit runId for the current run).\n' +
      '- {"kind":"set_run_progress","runId":string,"skidsCompleted":number?,"casesOnCurrentSkid":number?,"casesPerSkid":number?} — update a run\'s progress counters.\n' +
      '- {"kind":"log_actual_cases","runId":string,"actualCases":number} — record final actual cases for a run.\n' +
      '- {"kind":"log_waste","runId":string,"wasteLbs":number} — record waste pounds for a run.\n' +
      '- {"kind":"restock_item","itemKey":string,"qty":number} — receive/add stock of an existing inventory item.\n' +
      '- {"kind":"adjust_item","itemId":number,"qtyDelta":number,"note":string?} — adjust an item\'s on-hand by a delta (negative to remove).\n' +
      '- {"kind":"rollover"} — close out the whole day and start a fresh next day (only for an explicit "roll over the day"/"start a new day"/"close out the day"; irreversible, manager-only).',
  );
  lines.push(
    "Use run ids EXACTLY as id=... and inventory keys/ids EXACTLY as key=.../id=... above. " +
      "Only reference runs and items that appear in the data. If the phrase is a question, " +
      'return {"type":"question"}.',
  );

  return { system, user: lines.join("\n") };
}

// Lenient per-action schema — the model returns JSON but isn't trustworthy, so
// coerce and tolerate missing optionals, then resolve/validate below.
const RawActionSchema = z.object({
  kind: z.coerce.string().optional(),
  time: z.coerce.string().optional(),
  runId: z.coerce.string().optional(),
  casesNeeded: z.coerce.number().optional(),
  beforeRunId: z.coerce.string().nullish(),
  brand: z.coerce.string().optional(),
  flavor: z.coerce.string().optional(),
  reason: z.coerce.string().optional(),
  stoppageType: z.coerce.string().optional(),
  skidsCompleted: z.coerce.number().optional(),
  casesOnCurrentSkid: z.coerce.number().optional(),
  casesPerSkid: z.coerce.number().optional(),
  actualCases: z.coerce.number().optional(),
  wasteLbs: z.coerce.number().optional(),
  itemKey: z.coerce.string().optional(),
  itemId: z.coerce.number().optional(),
  qty: z.coerce.number().optional(),
  qtyDelta: z.coerce.number().optional(),
  note: z.coerce.string().optional(),
});

const ResponseSchema = z.object({
  type: z.coerce.string().optional(),
  note: z.coerce.string().optional(),
  actions: z.array(z.unknown()).optional(),
});

function runLabel(g: CommandGrounding, runId: string): string {
  const r = g.runs.get(runId);
  if (!r) return "run";
  const bf = `${r.brand} ${r.flavor}`.trim();
  return bf || r.label || "run";
}

function nonNegInt(n: number | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  return v >= 0 ? v : null;
}

// Resolve + validate ONE model-proposed action against the grounding. Returns
// null (drop the action) for anything malformed, hallucinated, or out of bounds.
// Run-targeted kinds must reference a known run id; restock/adjust must reference
// a known inventory item, and the server fills category/name/unit from the
// resolved item so the client mutation never trusts model-typed metadata.
function resolveAction(raw: unknown, g: CommandGrounding): VoiceCommandAction | null {
  const parsed = RawActionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const kind = (a.kind ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

  switch (kind) {
    case "set_target_time": {
      const time = (a.time ?? "").trim();
      if (!HHMM.test(time)) return null;
      return { kind: "set_target_time", label: `Set finish time to ${time}`, time };
    }
    case "clear_target_time":
      return { kind: "clear_target_time", label: "Clear finish time" };
    case "set_run_target": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      const casesNeeded = Math.round(a.casesNeeded ?? NaN);
      if (!Number.isFinite(casesNeeded) || casesNeeded <= 0 || casesNeeded > MAX_TARGET_CASES)
        return null;
      return {
        kind: "set_run_target",
        label: `Set ${runLabel(g, runId)} target to ${casesNeeded} cases`,
        runId,
        casesNeeded,
      };
    }
    case "reorder_run": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      const beforeRaw = a.beforeRunId == null ? null : a.beforeRunId.trim();
      const beforeRunId = beforeRaw ? beforeRaw : null;
      if (beforeRunId !== null && (!g.runs.has(beforeRunId) || beforeRunId === runId)) return null;
      const where = beforeRunId ? `before ${runLabel(g, beforeRunId)}` : "to the end";
      return { kind: "reorder_run", label: `Move ${runLabel(g, runId)} ${where}`, runId, beforeRunId };
    }
    case "add_run": {
      const brand = clamp(a.brand ?? "", MAX_NAME_CHARS);
      const flavor = clamp(a.flavor ?? "", MAX_NAME_CHARS);
      if (!brand && !flavor) return null;
      const name = `${brand} ${flavor}`.trim();
      return { kind: "add_run", label: `Add run ${name}`, brand, flavor };
    }
    case "remove_run": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      return { kind: "remove_run", label: `Remove ${runLabel(g, runId)}`, runId };
    }
    case "switch_run": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      return { kind: "switch_run", label: `Switch to ${runLabel(g, runId)}`, runId };
    }
    case "update_run_meta": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      const brand = a.brand != null ? clamp(a.brand, MAX_NAME_CHARS) : undefined;
      const flavor = a.flavor != null ? clamp(a.flavor, MAX_NAME_CHARS) : undefined;
      if (!brand && !flavor) return null;
      const to = [brand, flavor].filter(Boolean).join(" ");
      return { kind: "update_run_meta", label: `Rename ${runLabel(g, runId)} to ${to}`, runId, brand, flavor };
    }
    case "finish_run": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      return { kind: "finish_run", label: `Finish ${runLabel(g, runId)}`, runId };
    }
    case "start_stoppage": {
      const runId = (a.runId ?? "").trim();
      if (runId && !g.runs.has(runId)) return null;
      const reason = clamp(a.reason ?? "", MAX_NAME_CHARS) || "Stoppage";
      const stoppageType = normalizeStoppageKind(a.stoppageType, reason);
      return {
        kind: "start_stoppage",
        label: `Start stoppage: ${reason}`,
        ...(runId ? { runId } : {}),
        reason,
        stoppageType,
      };
    }
    case "end_stoppage": {
      const runId = (a.runId ?? "").trim();
      if (runId && !g.runs.has(runId)) return null;
      return { kind: "end_stoppage", label: "End stoppage", ...(runId ? { runId } : {}) };
    }
    case "set_run_progress": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      const skidsCompleted = nonNegInt(a.skidsCompleted);
      const casesOnCurrentSkid = nonNegInt(a.casesOnCurrentSkid);
      const casesPerSkid = nonNegInt(a.casesPerSkid);
      if (skidsCompleted == null && casesOnCurrentSkid == null && casesPerSkid == null) return null;
      return {
        kind: "set_run_progress",
        label: `Update progress for ${runLabel(g, runId)}`,
        runId,
        ...(skidsCompleted != null ? { skidsCompleted } : {}),
        ...(casesOnCurrentSkid != null ? { casesOnCurrentSkid } : {}),
        ...(casesPerSkid != null ? { casesPerSkid } : {}),
      };
    }
    case "log_actual_cases": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      const actualCases = nonNegInt(a.actualCases);
      if (actualCases == null || actualCases > MAX_TARGET_CASES) return null;
      return {
        kind: "log_actual_cases",
        label: `Log ${actualCases} actual cases for ${runLabel(g, runId)}`,
        runId,
        actualCases,
      };
    }
    case "log_waste": {
      const runId = (a.runId ?? "").trim();
      if (!g.runs.has(runId)) return null;
      const wasteLbs = a.wasteLbs;
      if (wasteLbs == null || !Number.isFinite(wasteLbs) || wasteLbs < 0 || wasteLbs > MAX_QTY)
        return null;
      const rounded = Math.round(wasteLbs * 100) / 100;
      return {
        kind: "log_waste",
        label: `Log ${rounded} lbs waste for ${runLabel(g, runId)}`,
        runId,
        wasteLbs: rounded,
      };
    }
    case "restock_item": {
      const itemKey = (a.itemKey ?? "").trim();
      const item = g.inventoryByKey.get(itemKey);
      if (!item) return null;
      const qty = a.qty;
      if (qty == null || !Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) return null;
      const rounded = Math.round(qty * 100) / 100;
      return {
        kind: "restock_item",
        label: `Restock ${rounded} ${item.unit} of ${item.name}`,
        itemKey,
        category: item.category,
        name: item.name,
        unit: item.unit,
        qty: rounded,
      };
    }
    case "adjust_item": {
      const itemId = a.itemId;
      if (itemId == null || !Number.isInteger(itemId)) return null;
      const item = g.inventoryById.get(itemId);
      if (!item) return null;
      const qtyDelta = a.qtyDelta;
      if (qtyDelta == null || !Number.isFinite(qtyDelta) || qtyDelta === 0 || Math.abs(qtyDelta) > MAX_QTY)
        return null;
      const rounded = Math.round(qtyDelta * 100) / 100;
      const note = a.note != null ? clamp(a.note, MAX_NOTE_CHARS) : undefined;
      const sign = rounded > 0 ? "+" : "";
      return {
        kind: "adjust_item",
        label: `Adjust ${item.name} by ${sign}${rounded} ${item.unit}`,
        itemId,
        qtyDelta: rounded,
        ...(note ? { note } : {}),
      };
    }
    case "rollover":
      return { kind: "rollover", label: "Roll over to a new day" };
    default:
      return null;
  }
}

// Parse + validate the model's classification. Lenient JSON parse; an unparseable
// or shapeless response collapses to a safe "none" rather than throwing. A
// "command" with zero surviving actions also becomes "none" so the client never
// claims to have done something it didn't.
export function sanitizeCommand(content: string, g: CommandGrounding): VoiceCommandResponse {
  const raw = (content ?? "").trim();
  if (!raw) return { type: "none", note: "I didn't catch that." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: "none", note: "I didn't catch that." };
  }

  const top = ResponseSchema.safeParse(parsed);
  if (!top.success) return { type: "none", note: "I didn't catch that." };

  const type = (top.data.type ?? "").trim().toLowerCase();
  if (type === "question") return { type: "question" };

  if (type === "command") {
    const actions: VoiceCommandAction[] = [];
    for (const rawAction of top.data.actions ?? []) {
      if (actions.length >= MAX_COMMAND_ACTIONS) break;
      const resolved = resolveAction(rawAction, g);
      if (resolved) actions.push(resolved);
    }
    if (actions.length === 0) {
      const note = clamp(top.data.note ?? "", MAX_NOTE_CHARS);
      return { type: "none", note: note || "I couldn't turn that into an action." };
    }
    return { type: "command", actions };
  }

  const note = clamp(top.data.note ?? "", MAX_NOTE_CHARS);
  return { type: "none", note: note || "I couldn't turn that into an action." };
}
