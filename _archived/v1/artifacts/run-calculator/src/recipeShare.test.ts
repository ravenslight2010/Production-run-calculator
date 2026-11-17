// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  printRecipe,
  recipeHeading,
  recipeShareText,
  shareRecipe,
  type ShareableRecipe,
} from "./recipeShare";

const cheese: ShareableRecipe = {
  title: "Applicator 1 — Cheese Blend",
  name: "Whole Milk Blend",
  unit: "lbs/batch",
  rows: [
    { ingredient: "Whole Milk Mozzarella", amount: 120 },
    { ingredient: "Provolone", amount: 30.256 },
    { ingredient: "   ", amount: 5 },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("recipeHeading", () => {
  it("prefixes the recipe name when present", () => {
    expect(recipeHeading(cheese)).toBe("Whole Milk Blend — Applicator 1 — Cheese Blend");
  });
  it("falls back to the title alone", () => {
    expect(recipeHeading({ ...cheese, name: "  " })).toBe("Applicator 1 — Cheese Blend");
    expect(recipeHeading({ ...cheese, name: undefined })).toBe("Applicator 1 — Cheese Blend");
  });
});

describe("recipeShareText", () => {
  it("lists non-blank rows with unit and a rounded total", () => {
    const text = recipeShareText(cheese);
    expect(text).toContain("Whole Milk Blend — Applicator 1 — Cheese Blend");
    expect(text).toContain("- Whole Milk Mozzarella: 120 lbs/batch");
    expect(text).toContain("- Provolone: 30.26 lbs/batch");
    // Blank-ingredient row skipped everywhere, including the total.
    expect(text).not.toContain(": 5 ");
    expect(text).toContain("Total: 150.26 lbs/batch");
  });

  it("handles empty recipes and non-finite amounts", () => {
    const text = recipeShareText({
      title: "Sauce Recipe",
      unit: "lbs/batch",
      rows: [{ ingredient: "Water", amount: Number.NaN }],
    });
    expect(text).toContain("- Water: 0 lbs/batch");
    expect(text).toContain("Total: 0 lbs/batch");
    const empty = recipeShareText({ title: "Sauce Recipe", unit: "lbs/batch", rows: [] });
    expect(empty).toContain("(no ingredients yet)");
  });
});

describe("shareRecipe", () => {
  it("uses navigator.share when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    await expect(shareRecipe(cheese)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: recipeHeading(cheese) }),
    );
  });

  it("treats AbortError (user closed sheet) as shared, without touching the clipboard", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")),
      clipboard: { writeText },
    });
    await expect(shareRecipe(cheese)).resolves.toBe("shared");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when share is unavailable or fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(shareRecipe(cheese)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(recipeShareText(cheese));

    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(new Error("boom")),
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(shareRecipe(cheese)).resolves.toBe("copied");
  });

  it("reports failed when nothing works", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(shareRecipe(cheese)).resolves.toBe("failed");
  });
});

describe("printRecipe", () => {
  function fakePrintWindow() {
    const written: string[] = [];
    return {
      written,
      win: {
        document: {
          write: (html: string) => written.push(html),
          close: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      },
    };
  }

  it("returns false when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(printRecipe(cheese)).toBe(false);
  });

  it("escapes recipe content in the printable HTML", () => {
    const { written, win } = fakePrintWindow();
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    const nasty: ShareableRecipe = {
      title: 'Cheese <script>alert("x")</script>',
      name: "A & B's \"Blend\"",
      unit: "lbs/batch",
      rows: [{ ingredient: "<img src=x onerror=alert(1)>", amount: 2 }],
    };
    expect(printRecipe(nasty)).toBe(true);
    const html = written.join("");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("A &amp; B&#39;s &quot;Blend&quot;");
    expect(win.print).toHaveBeenCalled();
    expect(win.document.close).toHaveBeenCalled();
  });
});
