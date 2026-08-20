/**
 * Foreground sync wiring guard.
 *
 * The counter-level regression lives in useAutoTrack.screenWake.test.ts. This
 * companion guard protects the Home orchestration that makes that rebase safe:
 * it must pull the client-date row, route it through the established inbound
 * merge, coalesce focus + visibility wake events, and never call a failed pull
 * "reconciled".
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const HOME_FILE = path.join(__dirname, "pages", "home.tsx");
const HOOK_FILE = path.join(__dirname, "hooks", "useAutoTrack.ts");
const homeSource = fs.readFileSync(HOME_FILE, "utf8");
const hookSource = fs.readFileSync(HOOK_FILE, "utf8");

describe("foreground wake sync barrier", () => {
  it("pulls the date-scoped row through the established inbound merge before releasing auto-track", () => {
    expect(homeSource).toContain("foregroundSyncInFlightRef.current");
    expect(homeSource).toContain("setAutoTrackBlocked(true)");
    expect(homeSource).toContain("`/api/sync/today?today=${todayStr()}`");
    expect(homeSource).toContain('cache: "no-store"');
    expect(homeSource).toContain("applySyncCallbackRef.current(payload)");
    expect(homeSource).toContain("setAutoTrackBlocked(false)");
    expect(homeSource).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(homeSource).toContain('window.addEventListener("focus", onFocus)');
  });

  it("holds queued pushes, retries normally after a failed pull, and does not mark failure as reconciled", () => {
    expect(homeSource).toContain("if (foregroundSyncBarrierRef.current)");
    expect(homeSource).toContain("foregroundPushPendingRef.current = true");
    expect(homeSource).toContain("if (!res.ok) throw new Error(`foreground sync GET failed: ${res.status}`)");
    expect(homeSource).toContain("reconciled = true");
    expect(homeSource).toContain("if (shouldPush || !reconciled)");

    const catchBlock = homeSource.match(
      /catch \{\s*\/\/ Failed pulls are not successful reconciliation[\s\S]*?return false;\s*\}/,
    )?.[0] ?? "";
    expect(catchBlock).toContain("return false");
    expect(catchBlock).not.toContain("reconciled = true");
  });

  it("prevents the first released clock tick from writing the hidden-time delta", () => {
    expect(hookSource).toContain("autoTrackBlocked");
    expect(hookSource).toContain("rebaseAfterForegroundSync");
    expect(hookSource).toContain("lastExpectedCasesRef.current = autoTrackSuggestion?.expectedCasesRaw ?? -1");
    expect(hookSource).toContain("if (autoTrackBlocked || disabled");
  });
});