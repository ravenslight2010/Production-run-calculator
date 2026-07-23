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
import { ManualOverrideBanner, manualOverrideBannerShow } from "./pages/home";

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

    // "Resume now" button must be visible and clickable
    expect(screen.getByTestId("btn-resume-now")).toBeTruthy();
    expect(screen.getByTestId("btn-resume-now").textContent).toMatch(/Resume now/i);
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
