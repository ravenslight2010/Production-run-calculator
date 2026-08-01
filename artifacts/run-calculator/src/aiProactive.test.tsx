// @vitest-environment jsdom
//
// Behavior tests for the proactive shift-alert hook's client-side de-dup +
// cooldown logic (the part that keeps the banner from nagging or flickering).
// The server decides IF/WHAT to surface and returns a stable de-dup `key`; the
// CLIENT owns:
//   - de-dup: the alert already on screen is never re-triggered by its own key;
//   - cooldown: a dismissed key is suppressed for the (manager-tunable) window,
//     then is allowed to resurface once the window elapses;
//   - a different key surfaces on the next poll.
//
// The web hook (artifacts/run-calculator/src/aiProactive.ts) is imported and
// rendered directly. The mobile hook
// (artifacts/run-calculator-mobile/context/aiProactive.ts) carries byte-identical
// logic behind a React Native / Expo import graph that can't load in node, so it
// is pulled in through the strip-imports -> transpile -> temp-file-import
// pipeline documented in .agents/memory/web-test-harness.md (a STUB_PRELUDE
// supplies the symbols the stripped imports used to provide), and the SAME suite
// is run against it. This enforces the replit.md web<->mobile parity rule for the
// proactive-alert behavior, not just for its source bytes.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as React from "react";

import {
  useProactiveAlert as webUseProactiveAlert,
  PROACTIVE_IDLE_POLL_MULTIPLIER,
  type ProactiveAlert,
  type ProactiveSettings,
} from "./aiProactive";
import { InventoryApiError } from "./inventoryShared";
import type { OptimizeInput } from "./aiOptimize";

// ── Hook signature shared by both platform copies ────────────────────────────
type UseProactiveAlertFn = (args: {
  enabled: boolean;
  buildInput: () => OptimizeInput | null;
}) => { alert: ProactiveAlert | null; dismiss: () => void };

// ── Mobile hook loader (strip-imports -> transpile-to-CJS -> evaluate) ────────
// The mobile copy lives behind a React Native / Expo import graph that can't load
// in node. We strip its imports, transpile to CommonJS, and evaluate the result
// in a `new Function` scope, INJECTING the test's own React hooks + stubbed
// platform plumbing as parameters. Critically, the hooks must be the *same* React
// instance @testing-library/react renders with — a second copy (e.g. a natively
// imported temp file) would break the hook dispatcher — so we pass them in rather
// than letting the module resolve "react" itself. The stubs make the module's
// fetch URLs (base "http://test") match the same routes the web copy uses, and
// saveFacilityKnowledge a no-op so a dismissal write never hits the network.
const here = path.dirname(fileURLToPath(import.meta.url));
// Mobile app is archived — parity test paused. Path updated to archived location.
const MOBILE_FILE = path.resolve(here, "../../../_archived/mobile/context/aiProactive.ts");

async function loadStrippedMobileHook(file: string): Promise<UseProactiveAlertFn> {
  const ts = (await import("typescript")).default;
  const raw = fs.readFileSync(file, "utf8");
  // Drop every `import ... from "...";` — the symbols they provided are injected
  // as `new Function` parameters below, so they stay free identifiers here.
  const withoutImports = raw.replace(/import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g, "");
  const { outputText } = ts.transpileModule(withoutImports, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      isolatedModules: true,
    },
  });
  const factory = new Function(
    "exports",
    "useCallback",
    "useEffect",
    "useRef",
    "useState",
    "getAuthToken",
    "getApiBaseUrl",
    "getOrCreateClientId",
    "InventoryApiError",
    "saveFacilityKnowledge",
    outputText,
  );
  const mod: { useProactiveAlert?: UseProactiveAlertFn } = {};
  factory(
    mod,
    React.useCallback,
    React.useEffect,
    React.useRef,
    React.useState,
    async () => "test-token",
    () => "http://test",
    async () => "test-client",
    InventoryApiError,
    async () => {},
  );
  if (!mod.useProactiveAlert) throw new Error("mobile useProactiveAlert export not found");
  return mod.useProactiveAlert;
}

let mobileUseProactiveAlert: UseProactiveAlertFn;

beforeAll(async () => {
  mobileUseProactiveAlert = await loadStrippedMobileHook(MOBILE_FILE);
});

// ── Fake server the hook polls against ───────────────────────────────────────
// The hook makes two calls per cycle: GET /api/ai/proactive-settings (cadence +
// cooldown) and POST /api/ai/proactive-alert (the nudge, or null). Both copies'
// URLs are matched by substring so the web ("/api/...") and mobile
// ("http://test/api/...") forms both route here.
let serverSettings: ProactiveSettings;
let serverAlert: ProactiveAlert | null;
let alertPostCount: number;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/api/ai/proactive-settings")) return jsonResponse(serverSettings);
  if (url.includes("/api/ai/proactive-alert")) {
    alertPostCount += 1;
    return jsonResponse({ alert: serverAlert, generatedAt: Date.now() });
  }
  // Dismissal write (web) / any other call — accept and ignore.
  if (url.includes("/api/ai-memory/facility")) return jsonResponse({ ok: true });
  return jsonResponse({});
});

const POLL_SECONDS = 30; // clamped minimum, keeps the fake clock easy to reason about
const POLL_MS = POLL_SECONDS * 1000;

function alert(key: string, title: string): ProactiveAlert {
  return { key, category: "run", title, detail: `${title} detail`, impact: "high" };
}

// A non-null OptimizeInput describing an ACTIVE day (a run in progress). The
// de-dup/cooldown suite relies on the per-poll base cadence, so it must look
// active; the separate idle-cadence test below supplies an idle input.
const buildInput = () => ({ runs: [{ status: "running" }] }) as unknown as OptimizeInput;

// An idle day: no run in progress, so the watcher backs off to the slower idle
// cadence.
const buildIdleInput = () => ({ runs: [{ status: "ended" }] }) as unknown as OptimizeInput;

// Advance the fake clock (and flush the awaited fetch chain) inside act().
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// ── Shared suite, run against both platform hooks ────────────────────────────
function defineSuite(label: string, getHook: () => UseProactiveAlertFn) {
  describe(`useProactiveAlert [${label}]`, () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", fetchMock);
      fetchMock.mockClear();
      serverSettings = { enabled: true, pollSeconds: POLL_SECONDS, cooldownSeconds: 1800 };
      serverAlert = null;
      alertPostCount = 0;
    });

    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it("surfaces the server's alert on the next poll", async () => {
      serverAlert = alert("behind", "Behind plan");
      const { result } = renderHook(() => getHook()({ enabled: true, buildInput }));
      expect(result.current.alert).toBeNull();
      await advance(POLL_MS);
      expect(result.current.alert?.key).toBe("behind");
      expect(result.current.alert?.title).toBe("Behind plan");
    });

    it("does not re-trigger the alert already on screen (same key)", async () => {
      serverAlert = alert("behind", "Behind plan");
      const { result } = renderHook(() => getHook()({ enabled: true, buildInput }));
      await advance(POLL_MS);
      expect(result.current.alert?.title).toBe("Behind plan");

      // Server keeps returning the SAME key with a fresh object/title. De-dup must
      // keep the original on screen — a re-set would flicker the banner.
      serverAlert = alert("behind", "Behind plan (updated copy)");
      await advance(POLL_MS);
      await advance(POLL_MS);
      expect(result.current.alert?.title).toBe("Behind plan");
    });

    it("surfaces a different key immediately on the next poll", async () => {
      serverAlert = alert("behind", "Behind plan");
      const { result } = renderHook(() => getHook()({ enabled: true, buildInput }));
      await advance(POLL_MS);
      expect(result.current.alert?.key).toBe("behind");

      serverAlert = alert("break", "Break window opening");
      await advance(POLL_MS);
      expect(result.current.alert?.key).toBe("break");
      expect(result.current.alert?.title).toBe("Break window opening");
    });

    it("suppresses a dismissed key for the cooldown window, then lets it resurface", async () => {
      serverSettings = { enabled: true, pollSeconds: POLL_SECONDS, cooldownSeconds: 60 };
      serverAlert = alert("behind", "Behind plan");
      const { result } = renderHook(() => getHook()({ enabled: true, buildInput }));
      await advance(POLL_MS);
      expect(result.current.alert?.key).toBe("behind");

      act(() => result.current.dismiss());
      expect(result.current.alert).toBeNull();

      // Same key keeps coming back from the server, but it stays suppressed while
      // inside the 60s cooldown (one poll later, +30s).
      await advance(POLL_MS);
      expect(result.current.alert).toBeNull();

      // Past the cooldown window, the same key is allowed to resurface.
      await advance(POLL_MS * 3);
      expect(result.current.alert?.key).toBe("behind");
    });

    it("suppresses ONLY the dismissed key — a different key still surfaces during cooldown", async () => {
      serverSettings = { enabled: true, pollSeconds: POLL_SECONDS, cooldownSeconds: 1800 };
      serverAlert = alert("behind", "Behind plan");
      const { result } = renderHook(() => getHook()({ enabled: true, buildInput }));
      await advance(POLL_MS);
      act(() => result.current.dismiss());
      expect(result.current.alert).toBeNull();

      // A brand-new key is unaffected by the dismissed key's cooldown.
      serverAlert = alert("break", "Break window opening");
      await advance(POLL_MS);
      expect(result.current.alert?.key).toBe("break");
    });

    it("stops polling and clears the alert when disabled", async () => {
      serverAlert = alert("behind", "Behind plan");
      const { result, rerender } = renderHook(
        ({ enabled }) => getHook()({ enabled, buildInput }),
        { initialProps: { enabled: true } },
      );
      await advance(POLL_MS);
      expect(result.current.alert?.key).toBe("behind");

      rerender({ enabled: false });
      expect(result.current.alert).toBeNull();
    });

    it("polls on the base cadence during an active shift", async () => {
      // Active day (a run in progress): a second poll lands one base interval
      // after the immediate first poll, so two polls fire within one base window.
      renderHook(() => getHook()({ enabled: true, buildInput }));
      await advance(POLL_MS);
      expect(alertPostCount).toBe(2);
    });

    it("polls less often on an idle day to save background cost", async () => {
      // Idle day (no run in progress): after the immediate first poll the watcher
      // backs off by the idle multiplier. One base interval later it has NOT
      // polled again; only after a full idle interval does the next poll fire.
      renderHook(() => getHook()({ enabled: true, buildInput: buildIdleInput }));
      await advance(POLL_MS);
      expect(alertPostCount).toBe(1); // still just the first poll — backed off

      // Step the rest of the way to the idle interval; the next poll fires there.
      await advance(POLL_MS * (PROACTIVE_IDLE_POLL_MULTIPLIER - 1));
      expect(alertPostCount).toBe(2);
    });
  });
}

defineSuite("web", () => webUseProactiveAlert);
defineSuite("mobile", () => mobileUseProactiveAlert);
