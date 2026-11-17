// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Home accessibility contracts", () => {
  it("keeps both manager-attention count badges above the small-text contrast minimum", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");

    const headerBadgeStart = home.indexOf(
      "aria-label={`${managerAttentionTotal} manager actions need attention`}",
    );
    const headerBadgeEnd = home.indexOf("</span>", headerBadgeStart);
    const headerBadge = home.slice(headerBadgeStart, headerBadgeEnd);

    const menuItemStart = home.indexOf(
      "`Manager attention — ${managerAttentionTotal} manager actions need attention`",
    );
    const menuItemEnd = home.indexOf("</DropdownMenuItem>", menuItemStart);
    const menuItem = home.slice(menuItemStart, menuItemEnd);
    const menuBadgeStart = menuItem.indexOf('aria-hidden="true"');
    const menuBadgeEnd = menuItem.indexOf("</span>", menuBadgeStart);
    const menuBadge = menuItem.slice(menuBadgeStart, menuBadgeEnd);

    const className = (source: string) => source.match(/className="([^"]+)"/)?.[1] ?? "";
    const badges = [className(headerBadge), className(menuBadge)];

    expect(headerBadgeStart).toBeGreaterThanOrEqual(0);
    expect(headerBadgeEnd).toBeGreaterThan(headerBadgeStart);
    expect(menuItemStart).toBeGreaterThanOrEqual(0);
    expect(menuItemEnd).toBeGreaterThan(menuItemStart);
    expect(menuBadgeStart).toBeGreaterThanOrEqual(0);
    expect(menuBadgeEnd).toBeGreaterThan(menuBadgeStart);
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge).toContain("bg-amber-800");
      expect(badge).toContain("text-white");
      expect(badge).not.toMatch(/bg-amber-(500|700)\b/);
    }
  });
});
