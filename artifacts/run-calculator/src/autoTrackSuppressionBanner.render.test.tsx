// @vitest-environment jsdom
//
// Rendered verification for the "Manual override active" banner shown by
// ManualOverrideBanner (exported from pages/home.tsx) while auto-track
// writes are suppressed after a manual stepper override.
//
// This tests the ACTUAL component used by LivePackagingTabContent (~line
// 16968) and LiveDoughTabContent (~line 17406) in home.tsx. Both call sites
// compose the banner's `show` prop from:
//
//   manualOverrideBannerShow(autoTrackProgress, autoTrackSuggestion, autoSuppressUntilRef.current)
//
// Suite 1 drives the three user-visible states directly (show=true/false,
// onResume click) without needing to mount the full 18k-line home.tsx tree.
//
// Suite 2 (call-site formula guard) imports the REAL exported predicate
// `manualOverrideBannerShow` — the identical function called by both
// LivePackagingTabContent and LiveDoughTabContent.  Any future change to
// its conditions (adding / removing a term) will automatically make the
// suite-2 tests fail, making the mismatch visible before it ships.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ManualOverrideBanner, manualOverrideBannerShow } from "./components/ManualOverrideBanner";

afterEach(cleanup);

describe("ManualOverrideBanner — manual override active banner", () => {
  it("shows 'Manual override active' text and minutes-left when show=true", () => {
    render(<ManualOverrideBanner show minsLeft={1} onResume={() => {}} />);

    const banner = screen.getByTestId("manual-override-banner");
    expect(banner).toBeTruthy();

    // Text must include the override message
    expect(banner.textContent).toMatch(/Manual override active/i);
    // Minutes left must appear (fmtMins(1) = "1 min")
    expect(banner.textContent).toMatch(/1 min/);

    // Station-specific resume action must be visible and clickable.
    expect(screen.getByTestId("btn-resume-now")).toBeTruthy();
    expect(banner.textContent).toMatch(/Dough station/i);
    expect(screen.getByTestId("btn-resume-now").textContent).toMatch(/Resume auto tracking/i);
  });

  it("calls onResume when 'Resume now' is clicked", () => {
    const onResume = vi.fn();
    render(<ManualOverrideBanner show minsLeft={1} onResume={onResume} />);

    fireEvent.click(screen.getByTestId("btn-resume-now"));

    expect(onResume).toHaveBeenCalledOnce();
  });

  it("renders nothing when show=false (suppression window inactive)", () => {
    render(<ManualOverrideBanner show={false} minsLeft={0} onResume={() => {}} />);

    // Banner must be completely absent from the DOM
    expect(screen.queryByTestId("manual-override-banner")).toBeNull();
    expect(screen.queryByText(/Manual override active/i)).toBeNull();
    expect(screen.queryByTestId("btn-resume-now")).toBeNull();
  });

  it("counter-proof: show=false does NOT call onResume even if clicked somewhere", () => {
    // Symmetric guard — when the banner is absent, the Resume now button
    // simply does not exist (can't be clicked). This confirms show=false
    // truly hides the button, not just the banner wrapper.
    const onResume = vi.fn();
    render(<ManualOverrideBanner show={false} minsLeft={0} onResume={onResume} />);

    expect(screen.queryByTestId("btn-resume-now")).toBeNull();
    expect(onResume).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: call-site formula guard
//
// These tests call `manualOverrideBannerShow` — the SAME exported function
// used by both LivePackagingTabContent and LiveDoughTabContent — then pass the
// result to ManualOverrideBanner exactly as the real call sites do.
//
// Because the tests import the real production function (not a local copy),
// any future refactor that adds or removes a condition from
// `manualOverrideBannerShow` is immediately reflected here: the
// `expect(show).toBe(...)` assertions will fail before the render assertions
// even run, giving a precise signal that the formula changed.
// ---------------------------------------------------------------------------
describe("ManualOverrideBanner — call-site formula guard (Suite 2)", () => {
  // Suppression window is always well in the future for this suite.
  const suppressUntil = Date.now() + 60_000;

  it("banner is absent when autoTrackProgress=false (window active, suggestion present)", () => {
    const show = manualOverrideBannerShow(
      false,                        // autoTrackProgress OFF
      { skids: 1, casesOnSkid: 2 }, // autoTrackSuggestion truthy
      suppressUntil,                // window active
    );

    // The real predicate must return false for this combination.
    expect(show).toBe(false);

    render(<ManualOverrideBanner show={show} minsLeft={0} onResume={() => {}} />);
    expect(screen.queryByTestId("manual-override-banner")).toBeNull();
    expect(screen.queryByText(/Manual override active/i)).toBeNull();
  });

  it("banner is absent when autoTrackSuggestion=null (window active, progress true)", () => {
    const show = manualOverrideBannerShow(
      true,          // autoTrackProgress ON
      null,          // autoTrackSuggestion falsy
      suppressUntil, // window active
    );

    expect(show).toBe(false);

    render(<ManualOverrideBanner show={show} minsLeft={0} onResume={() => {}} />);
    expect(screen.queryByTestId("manual-override-banner")).toBeNull();
    expect(screen.queryByText(/Manual override active/i)).toBeNull();
  });

  it("banner is absent when autoTrackSuggestion=undefined (window active, progress true)", () => {
    const show = manualOverrideBannerShow(
      true,
      undefined,     // also falsy — !!undefined === false
      suppressUntil,
    );

    expect(show).toBe(false);

    render(<ManualOverrideBanner show={show} minsLeft={0} onResume={() => {}} />);
    expect(screen.queryByTestId("manual-override-banner")).toBeNull();
  });

  it("counter-proof: banner IS shown when all three conditions are true", () => {
    const show = manualOverrideBannerShow(
      true,                           // autoTrackProgress ON
      { skids: 3, casesOnSkid: 5 },   // autoTrackSuggestion truthy
      suppressUntil,                  // window active
    );

    // Real predicate must return true.
    expect(show).toBe(true);

    const minsLeft = Math.ceil((suppressUntil - Date.now()) / 60_000);
    render(<ManualOverrideBanner show={show} minsLeft={minsLeft} onResume={() => {}} />);

    expect(screen.getByTestId("manual-override-banner")).toBeTruthy();
    expect(screen.getByTestId("manual-override-banner").textContent).toMatch(/Manual override active/i);
    expect(screen.getByTestId("btn-resume-now")).toBeTruthy();
  });

  it("banner is absent when suppression window has expired (both other conditions true)", () => {
    const expiredUntil = Date.now() - 1; // window in the past

    const show = manualOverrideBannerShow(
      true,
      { skids: 1, casesOnSkid: 1 },
      expiredUntil,
    );

    expect(show).toBe(false);

    render(<ManualOverrideBanner show={show} minsLeft={0} onResume={() => {}} />);
    expect(screen.queryByTestId("manual-override-banner")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: source-level call-site formula drift guard
//
// Reads home.tsx as plain text, extracts the complete show={...} expression
// from every ManualOverrideBanner call site, and asserts each expression
// exactly matches the canonical three-argument signature — with no additional
// operators, conditions, or argument substitutions allowed.
//
// Why this exists: Suite 2 tests the exported predicate function itself, but
// does not verify that the real JSX call sites actually delegate to that
// function.  A developer could rewrite a call site to use an inline boolean
// expression or append an extra `&& extraFlag` condition, and the Suite 2
// tests would still pass while the live banner behaviour silently diverged.
//
// This suite catches exactly that class of drift: any change to the `show=`
// expression at either call site that does not match the canonical form below
// will fail these tests immediately.
// ---------------------------------------------------------------------------
describe("ManualOverrideBanner — source-level call-site formula drift guard (Suite 3)", () => {
  // Resolve home.tsx relative to this test file so the path survives moves.
  const __filename = fileURLToPath(import.meta.url);
  const __dir = dirname(__filename);
  const homeSrc = readFileSync(join(__dir, "pages/home.tsx"), "utf-8");

  // Canonical form of the show= attribute at both ManualOverrideBanner call
  // sites.  The second argument is a local variable name that differs between
  // the two sites (s vs autoTrackSuggestion) so it is matched as \w+.
  // Crucially, the regex is anchored end-to-end with ^ and $, so any trailing
  // operator (&& / ||) or extra condition fails the assertion.
  const CANONICAL_SHOW_RE =
    /^show=\{manualOverrideBannerShow\(\s*autoTrackProgress\s*,\s*\w+\s*,\s*autoSuppressUntilRef\.current\s*\)\}$/;

  // Extracts every show={manualOverrideBannerShow(...)} attribute from src.
  // Both real call sites are on a single line, so a regex that captures from
  // `show={` to the closing `}` (with a single level of nested parens) is
  // sufficient and avoids a full AST parse.
  function extractShowProps(src: string): string[] {
    // [^)]* inside the outer parens matches a flat argument list (no nested
    // balanced parens needed — the predicate takes three simple identifiers).
    const re = /show=\{manualOverrideBannerShow\([^)]*\)\}/g;
    return (src.match(re) ?? []).map((s) => s.trim());
  }

  it("home.tsx contains exactly 2 ManualOverrideBanner JSX call sites", () => {
    // Count every <ManualOverrideBanner JSX tag.  The component definition
    // itself uses `export function ManualOverrideBanner`, which does NOT match
    // the JSX tag pattern, so every match here is a real call site.
    const matches = homeSrc.match(/<ManualOverrideBanner/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("every ManualOverrideBanner show= prop exactly matches the canonical three-arg signature", () => {
    const showProps = extractShowProps(homeSrc);

    // There must be exactly 2 show= attributes using the predicate function —
    // one per call site.  A count mismatch means a site was inlined or added.
    expect(showProps).toHaveLength(2);

    for (const prop of showProps) {
      // The full show={...} expression must conform to the canonical form:
      //   show={manualOverrideBannerShow(autoTrackProgress, <ident>, autoSuppressUntilRef.current)}
      // No trailing operators, no extra conditions, no argument substitutions.
      expect(prop).toMatch(CANONICAL_SHOW_RE);
    }
  });

  it("counter-proof: inline formula or extra operator would fail the canonical check", () => {
    // Verify that the CANONICAL_SHOW_RE rejects every known class of drift.
    const driftPatterns = [
      // Extra AND condition appended after the predicate
      "show={manualOverrideBannerShow(autoTrackProgress, s, autoSuppressUntilRef.current) && extraFlag}",
      // Extra OR override appended after the predicate
      "show={manualOverrideBannerShow(autoTrackProgress, s, autoSuppressUntilRef.current) || override}",
      // Inline three-condition formula replacing the predicate entirely
      "show={autoTrackProgress && !!s && Date.now() < autoSuppressUntilRef.current}",
      // Wrong first argument (hardcoded true instead of autoTrackProgress)
      "show={manualOverrideBannerShow(true, s, autoSuppressUntilRef.current)}",
      // Wrong last argument (local variable instead of the ref)
      "show={manualOverrideBannerShow(autoTrackProgress, s, suppressUntil)}",
    ];

    for (const pattern of driftPatterns) {
      expect(pattern).not.toMatch(CANONICAL_SHOW_RE);
    }
  });

  it("counter-proof: exactly 2 source lines contain the canonical show= prop", () => {
    // Belt-and-suspenders: confirm the source lines with the show= prop are
    // exactly 2, independently of the extractShowProps helper above.
    const callSiteLines = homeSrc
      .split("\n")
      .filter((line) => /show=\{manualOverrideBannerShow\(/.test(line));
    expect(callSiteLines).toHaveLength(2);
  });
});
