// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("nested mixed-import review layers", () => {
  it("scopes Schedule picker portals above its z-70 parent without raising global dialogs", () => {
    const home = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "src/components/ui/dialog.tsx"), "utf8");
    expect(home).toMatch(/showScheduleDialog && canManageFactorySettings && \(\s*<DialogLayerProvider value=\{80\}>/);
    expect(dialog).toContain('React.createContext<number | undefined>(undefined)');
    expect(dialog).toContain('<DialogOverlay style={zIndex === undefined ? undefined : { zIndex }}');
    expect(dialog).toContain('...(zIndex === undefined ? {} : { zIndex })');
    expect(dialog).toContain("z-50");
  });
  it("keeps Settings below importer previews and safety confirmations above both", () => {
    const home = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(home).toMatch(/HOME_DIALOG_OVERLAY_CLASS\s*=\s*\n?\s*"[^"]*z-\[70\]/);
    const safety = readFileSync(resolve(process.cwd(), "src/components/ImportSafetyReviewHost.tsx"), "utf8");
    expect(safety).toContain("z-[100]");
  });
  it.each(["ShippingImportDialog", "RecipeGuideImportDialog", "ExcelImportDialog", "SpecImportDialog", "PremixImportDialog", "CheeseImportDialog"])(
    "%s remains above the open grouped-review workspace",
    (name) => {
      const source = readFileSync(resolve(process.cwd(), `src/components/${name}.tsx`), "utf8");
      expect(source).toContain("z-[80]");
      expect(source).not.toContain("z-[60]");
    },
  );
});
