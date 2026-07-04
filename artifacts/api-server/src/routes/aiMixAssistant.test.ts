import { describe, it, expect } from "vitest";
import {
  validateMixAssistBody,
  buildMixAssistPrompt,
  sanitizeMixAnswer,
  MAX_QUESTION_CHARS,
  MAX_MIXES,
  MAX_COMPONENTS_PER_MIX,
} from "./aiMixAssistant";

function mix(over: Record<string, unknown> = {}) {
  return {
    name: "Cheese blend",
    brand: "Tony's",
    flavor: "Pepperoni",
    components: [{ ingredient: "Mozzarella", perPizza: 0.5 }],
    ...over,
  };
}

describe("validateMixAssistBody", () => {
  it("accepts a well-formed body and trims the question", () => {
    const result = validateMixAssistBody({ question: "  How much cheese?  ", mixes: [mix()] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.question).toBe("How much cheese?");
  });

  it("accepts an empty mixes array", () => {
    const result = validateMixAssistBody({ question: "anything?", mixes: [] });
    expect(result.ok).toBe(true);
  });

  it("rejects a blank question with 400", () => {
    const result = validateMixAssistBody({ question: "   ", mixes: [] });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a missing question with 400", () => {
    const result = validateMixAssistBody({ mixes: [] });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an over-long question with 400", () => {
    const result = validateMixAssistBody({
      question: "x".repeat(MAX_QUESTION_CHARS + 1),
      mixes: [],
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects too many mixes with 400", () => {
    const result = validateMixAssistBody({
      question: "q",
      mixes: Array.from({ length: MAX_MIXES + 1 }, () => mix()),
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a mix with too many components with 400", () => {
    const result = validateMixAssistBody({
      question: "q",
      mixes: [
        mix({
          components: Array.from({ length: MAX_COMPONENTS_PER_MIX + 1 }, () => ({
            ingredient: "x",
            perPizza: 1,
          })),
        }),
      ],
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe("buildMixAssistPrompt", () => {
  it("includes mix data and the question, advisory-only", () => {
    const { system, user } = buildMixAssistPrompt({
      question: "How much mozzarella per pizza?",
      mixes: [mix({ batchSize: 10 })],
    });
    expect(system).toContain("ADVISORY ONLY");
    expect(user).toContain("Mozzarella: 0.5 oz/pizza");
    expect(user).toContain("How much mozzarella per pizza?");
    expect(user).toContain('"answer"');
  });

  it("notes when there are no mixes", () => {
    const { user } = buildMixAssistPrompt({ question: "anything?", mixes: [] });
    expect(user).toContain("no mixes have been defined");
  });
});

describe("sanitizeMixAnswer", () => {
  it("extracts answer and note from JSON", () => {
    const r = sanitizeMixAnswer('{"answer":"Half a pound.","note":"per pizza"}');
    expect(r.answer).toBe("Half a pound.");
    expect(r.note).toBe("per pizza");
  });

  it("omits an empty note", () => {
    const r = sanitizeMixAnswer('{"answer":"Half a pound.","note":""}');
    expect(r.answer).toBe("Half a pound.");
    expect(r.note).toBeUndefined();
  });

  it("falls back to raw content when not JSON", () => {
    expect(sanitizeMixAnswer("plain text").answer).toBe("plain text");
  });

  it("returns empty for empty content", () => {
    expect(sanitizeMixAnswer("").answer).toBe("");
  });
});
