import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const homeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "pages/home.tsx"),
  "utf8",
);

describe("Packaging speed feedback quick-check wiring", () => {
  it("routes Packaging, Sauce, and Dough corrections through shared live feedback", () => {
    expect(homeSource).toContain("detectPackagingSpeedDrift");
    expect(homeSource.match(/const recordQuickCheckCorrection/g)).toHaveLength(2);
    expect(
      homeSource.match(/detectPackagingSpeedDrift\(nextTotal - currentTotal\)/g),
    ).toHaveLength(7);
  });

  it("keeps invalid cases-per-skid quick checks out of division paths", () => {
    expect(homeSource).toContain("const hasCps = v.casesPerSkid > 0;");
    expect(homeSource).toContain("const cps = hasCps ? v.casesPerSkid : 0;");
    expect(homeSource).toContain("const nextTotal = hasCps ? nextSkids * cps + nextCases : nextSkids;");
  });
});