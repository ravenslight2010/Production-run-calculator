import { describe, it, expect } from "vitest";
import {
  validateRecipeAssistBody,
  buildRecipeAssistPrompt,
  sanitizeRecipeAnswer,
  MAX_QUESTION_CHARS,
  MAX_ANSWER_CHARS,
  MAX_NOTE_CHARS,
  MAX_RECIPES,
  MAX_ROWS_PER_RECIPE,
  MAX_INGREDIENT_NAMES,
} from "./aiRecipeAssistant";

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    question: "Scale the dough recipe to 1.5x",
    recipes: [
      {
        kind: "dough",
        name: "House Dough",
        rows: [
          { ingredient: "Flour", lbs: 50 },
          { ingredient: "Water", lbs: 30 },
        ],
      },
    ],
    ingredientNames: ["Flour", "Water", "Salt", "Yeast"],
    context: { brand: "Acme", flavor: "Cheese", casesNeeded: 100, pizzasPerCase: 12, doughballWeightOz: 16 },
    ...overrides,
  };
}

describe("validateRecipeAssistBody — happy path", () => {
  it("accepts a well-formed body and trims the question", () => {
    const result = validateRecipeAssistBody(makeBody({ question: "  Scale the dough recipe to 1.5x  " }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.question).toBe("Scale the dough recipe to 1.5x");
      expect(result.data.recipes).toHaveLength(1);
      expect(result.data.ingredientNames).toContain("Salt");
      expect(result.data.context?.brand).toBe("Acme");
    }
  });

  it("accepts a body with no recipes and no context", () => {
    const result = validateRecipeAssistBody({ question: "What can I sub for flour?", recipes: [] });
    expect(result.ok).toBe(true);
  });
});

describe("validateRecipeAssistBody — guards", () => {
  it("rejects a non-object body", () => {
    expect(validateRecipeAssistBody(null).ok).toBe(false);
    expect(validateRecipeAssistBody("nope").ok).toBe(false);
    expect(validateRecipeAssistBody(42).ok).toBe(false);
  });

  it("rejects a missing question", () => {
    const result = validateRecipeAssistBody({ recipes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a blank / whitespace-only question with a 400", () => {
    const result = validateRecipeAssistBody(makeBody({ question: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/question is required/i);
    }
  });

  it("rejects an over-long question with a 400", () => {
    const result = validateRecipeAssistBody(makeBody({ question: "a".repeat(MAX_QUESTION_CHARS + 1) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/too long/i);
    }
  });

  it("rejects a missing recipes array", () => {
    const result = validateRecipeAssistBody({ question: "Scale it" });
    expect(result.ok).toBe(false);
  });

  it("rejects too many recipes", () => {
    const recipes = Array.from({ length: MAX_RECIPES + 1 }, (_, i) => ({
      kind: "cheese",
      name: `R${i}`,
      rows: [{ ingredient: "Mozz", lbs: 1 }],
    }));
    const result = validateRecipeAssistBody(makeBody({ recipes }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too many recipes/i);
  });

  it("rejects a recipe with too many rows", () => {
    const rows = Array.from({ length: MAX_ROWS_PER_RECIPE + 1 }, () => ({ ingredient: "X", lbs: 1 }));
    const result = validateRecipeAssistBody(makeBody({ recipes: [{ kind: "dough", name: "Big", rows }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too many rows/i);
  });

  it("rejects too many ingredient names", () => {
    const ingredientNames = Array.from({ length: MAX_INGREDIENT_NAMES + 1 }, (_, i) => `Ing${i}`);
    const result = validateRecipeAssistBody(makeBody({ ingredientNames }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too many ingredient names/i);
  });
});

describe("buildRecipeAssistPrompt — grounding", () => {
  it("includes the question, the real recipe rows + totals, and the known ingredients", () => {
    const valid = validateRecipeAssistBody(makeBody());
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const { system, user } = buildRecipeAssistPrompt(valid.data);
    // System prompt anchors the three jobs and the advisory/no-invent posture.
    expect(system).toMatch(/scale/i);
    expect(system).toMatch(/substitution/i);
    expect(system).toMatch(/explain/i);
    expect(system).toMatch(/never invent/i);
    expect(system).toMatch(/advisory only/i);
    // User prompt carries the real data.
    expect(user).toContain("QUESTION: Scale the dough recipe to 1.5x");
    expect(user).toContain("Flour: 50 lbs");
    expect(user).toContain("Water: 30 lbs");
    expect(user).toContain("total batch: 80 lbs");
    expect(user).toContain("KNOWN INGREDIENTS");
    expect(user).toContain("Salt");
    expect(user).toMatch(/Return ONLY JSON/);
  });

  it("renders run context when present", () => {
    const valid = validateRecipeAssistBody(makeBody());
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const { user } = buildRecipeAssistPrompt(valid.data);
    expect(user).toContain("RUN CONTEXT:");
    expect(user).toContain('product="Acme Cheese"');
    expect(user).toContain("casesNeeded=100");
    expect(user).toContain("doughballWeightOz=16");
  });

  it("renders (none) when there are no recipes and omits empty sections", () => {
    const valid = validateRecipeAssistBody({ question: "What can I sub for flour?", recipes: [] });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const { user } = buildRecipeAssistPrompt(valid.data);
    expect(user).toContain("(none — no recipe has been configured");
    expect(user).not.toContain("RUN CONTEXT:");
    expect(user).not.toContain("KNOWN INGREDIENTS");
  });
});

describe("sanitizeRecipeAnswer — JSON shape", () => {
  it("extracts answer + note from well-formed JSON", () => {
    expect(sanitizeRecipeAnswer('{"answer":"Flour 75, Water 45.","note":""}')).toEqual({
      answer: "Flour 75, Water 45.",
    });
    expect(sanitizeRecipeAnswer('{"answer":"Cannot tell.","note":"Need the recipe rows."}')).toEqual({
      answer: "Cannot tell.",
      note: "Need the recipe rows.",
    });
  });

  it("falls back to raw content when JSON parsing fails", () => {
    expect(sanitizeRecipeAnswer("Flour 75 lbs, Water 45 lbs.")).toEqual({
      answer: "Flour 75 lbs, Water 45 lbs.",
    });
  });

  it("falls back to raw content when JSON has neither answer nor note", () => {
    expect(sanitizeRecipeAnswer('{"foo":"bar"}')).toEqual({ answer: '{"foo":"bar"}' });
  });

  it("returns an empty answer for empty content", () => {
    expect(sanitizeRecipeAnswer("")).toEqual({ answer: "" });
    expect(sanitizeRecipeAnswer("   ")).toEqual({ answer: "" });
  });

  it("clamps an over-long answer and note", () => {
    const longAnswer = "x".repeat(MAX_ANSWER_CHARS + 500);
    const longNote = "y".repeat(MAX_NOTE_CHARS + 500);
    const out = sanitizeRecipeAnswer(JSON.stringify({ answer: longAnswer, note: longNote }));
    expect(out.answer.length).toBe(MAX_ANSWER_CHARS);
    expect(out.note?.length).toBe(MAX_NOTE_CHARS);
  });
});
