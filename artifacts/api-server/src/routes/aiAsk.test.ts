import { describe, it, expect } from "vitest";
import {
  buildConversationBlock,
  normalizeConversationTurns,
  trimConversationWindow,
  DEFAULT_CONVERSATION_WINDOW,
  type ConversationTurn,
} from "@workspace/ai-memory";
import {
  validateAskBody,
  buildAskPrompt,
  sanitizeAnswer,
  MAX_QUESTION_CHARS,
  MAX_ANSWER_CHARS,
  MAX_NOTE_CHARS,
} from "./aiAsk";

// A minimal run object that satisfies the day-state (OptimizeInput) run schema.
function makeRun(id: string) {
  return {
    id,
    label: `Run ${id}`,
    brand: "Brand",
    flavor: "Cheese",
    dieType: "12in",
    status: "running" as const,
    casesNeeded: 100,
    casesMade: 10,
    casesLeft: 90,
    plannedPpm: 60,
    actualPpm: 55,
    minutesRemaining: 30,
    netElapsedSec: 600,
    downtimeSec: 0,
    stoppages: [],
  };
}

function makeDayState(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-06-18",
    nowMs: 1_750_000_000_000,
    runs: [makeRun("run-1")],
    ...overrides,
  };
}

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    question: "Can we finish by 2pm?",
    dayState: makeDayState(),
    ...overrides,
  };
}

describe("validateAskBody — happy path", () => {
  it("accepts a well-formed body and returns the trimmed question + parsed day-state", () => {
    const result = validateAskBody(makeBody({ question: "  Can we finish by 2pm?  " }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.question).toBe("Can we finish by 2pm?");
      expect(result.data.dayState.runs).toHaveLength(1);
      expect(result.data.dayState.date).toBe("2026-06-18");
    }
  });
});

describe("validateAskBody — guards", () => {
  it("rejects a non-object body", () => {
    expect(validateAskBody(null).ok).toBe(false);
    expect(validateAskBody("nope").ok).toBe(false);
    expect(validateAskBody(42).ok).toBe(false);
  });

  it("rejects a missing question", () => {
    const result = validateAskBody({ dayState: makeDayState() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a blank / whitespace-only question with a 400", () => {
    const result = validateAskBody(makeBody({ question: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/question is required/i);
    }
  });

  it("rejects an over-long question with a 400", () => {
    const result = validateAskBody(makeBody({ question: "a".repeat(MAX_QUESTION_CHARS + 1) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/too long/i);
    }
  });

  it("rejects a missing day-state", () => {
    const result = validateAskBody({ question: "Can we finish by 2pm?" });
    expect(result.ok).toBe(false);
  });

  it("propagates the optimize day-state validation failure (bad run field)", () => {
    const result = validateAskBody(
      makeBody({ dayState: makeDayState({ runs: [{ ...makeRun("run-1"), casesNeeded: "lots" }] }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("buildAskPrompt — assembly", () => {
  it("includes the question, the date, and the run facts", () => {
    const input = {
      question: "Can we finish by 2pm?",
      dayState: makeDayState({ runToTime: "14:00", todayPpm: 58, benchmarkPpm: 60 }),
    };
    // validateAskBody returns the parsed/typed data; build straight from a valid body.
    const valid = validateAskBody(input);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    const { system, user } = buildAskPrompt(valid.data);
    expect(system).toMatch(/answer only from the real data/i);
    expect(system).toMatch(/never invent/i);
    expect(user).toContain("QUESTION: Can we finish by 2pm?");
    expect(user).toContain("DATE: 2026-06-18");
    expect(user).toContain("TARGET FINISH TIME: 2:00 PM");
    expect(user).toContain('label="Run run-1"');
    expect(user).toMatch(/Return ONLY JSON/);
  });

  it("renders (none) when there are no runs", () => {
    const valid = validateAskBody(makeBody({ dayState: makeDayState({ runs: [] }) }));
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const { user } = buildAskPrompt(valid.data);
    expect(user).toContain("TODAY'S RUNS:\n(none)");
  });

  it("includes scheduled and history sections only when present", () => {
    const withExtra = validateAskBody(
      makeBody({
        dayState: makeDayState({
          scheduledRuns: [
            { date: "2026-06-19", brand: "Brand", flavor: "Pepperoni", dieType: "12in", casesNeeded: 200 },
          ],
          historyRuns: [makeRun("hist-1")],
        }),
      }),
    );
    expect(withExtra.ok).toBe(true);
    if (!withExtra.ok) return;
    const withUser = buildAskPrompt(withExtra.data).user;
    expect(withUser).toContain("SCHEDULED (FUTURE) RUNS:");
    expect(withUser).toContain("RECENT FINISHED RUNS (history):");

    const bare = validateAskBody(makeBody());
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    const bareUser = buildAskPrompt(bare.data).user;
    expect(bareUser).not.toContain("SCHEDULED (FUTURE) RUNS:");
    expect(bareUser).not.toContain("RECENT FINISHED RUNS (history):");
  });
});

describe("sanitizeAnswer — JSON shape", () => {
  it("extracts answer + note from well-formed JSON", () => {
    expect(sanitizeAnswer('{"answer":"Yes, by 1:45pm.","note":""}')).toEqual({
      answer: "Yes, by 1:45pm.",
    });
    expect(sanitizeAnswer('{"answer":"Cannot tell.","note":"Need PPM history."}')).toEqual({
      answer: "Cannot tell.",
      note: "Need PPM history.",
    });
  });

  it("falls back to raw content when JSON parsing fails", () => {
    expect(sanitizeAnswer("Yes, you can finish by 2pm.")).toEqual({
      answer: "Yes, you can finish by 2pm.",
    });
  });

  it("falls back to raw content when JSON has neither answer nor note", () => {
    expect(sanitizeAnswer('{"foo":"bar"}')).toEqual({ answer: '{"foo":"bar"}' });
  });

  it("returns an empty answer for empty content", () => {
    expect(sanitizeAnswer("")).toEqual({ answer: "" });
    expect(sanitizeAnswer("   ")).toEqual({ answer: "" });
  });

  it("clamps an over-long answer and note", () => {
    const longAnswer = "x".repeat(MAX_ANSWER_CHARS + 500);
    const longNote = "y".repeat(MAX_NOTE_CHARS + 500);
    const out = sanitizeAnswer(JSON.stringify({ answer: longAnswer, note: longNote }));
    expect(out.answer.length).toBe(MAX_ANSWER_CHARS);
    expect(out.note?.length).toBe(MAX_NOTE_CHARS);
  });
});

// The ask endpoint persists per-user conversation turns and replays the recent
// window into later prompts. The windowing itself lives in @workspace/ai-memory;
// these guard the behavior the ask feature relies on.
describe("per-user conversation windowing (ask follow-up memory)", () => {
  it("keeps only the most recent window of turns, preserving order", () => {
    const turns: ConversationTurn[] = [];
    for (let i = 0; i < DEFAULT_CONVERSATION_WINDOW + 6; i++) {
      turns.push({ role: i % 2 === 0 ? "user" : "assistant", text: `turn ${i}` });
    }
    const trimmed = trimConversationWindow(turns);
    expect(trimmed).toHaveLength(DEFAULT_CONVERSATION_WINDOW);
    // The tail is retained: the last entry is the newest turn.
    expect(trimmed[trimmed.length - 1]?.text).toBe(`turn ${turns.length - 1}`);
    // Order is preserved (not reversed / deduped).
    expect(trimmed[0]?.text).toBe(`turn ${turns.length - DEFAULT_CONVERSATION_WINDOW}`);
  });

  it("normalizes raw stored turns: drops blanks, coerces role, keeps the tail", () => {
    const raw = [
      { role: "user", text: "first" },
      null,
      { role: "assistant", text: "  " },
      { role: "weird", text: "becomes user" },
      { role: "assistant", text: "answer" },
    ];
    const out = normalizeConversationTurns(raw, { window: 3 });
    expect(out).toEqual([
      { role: "user", text: "first" },
      { role: "user", text: "becomes user" },
      { role: "assistant", text: "answer" },
    ]);
  });

  it("renders a prompt-ready conversation block oldest-first", () => {
    const block = buildConversationBlock([
      { role: "user", text: "Can we finish by 2pm?" },
      { role: "assistant", text: "Yes, by 1:45pm." },
    ]);
    expect(block).toMatch(/User: Can we finish by 2pm\?/);
    expect(block).toMatch(/Assistant: Yes, by 1:45pm\./);
    expect(block.indexOf("User:")).toBeLessThan(block.indexOf("Assistant:"));
  });

  it("returns an empty block when there are no turns", () => {
    expect(buildConversationBlock([])).toBe("");
  });
});
