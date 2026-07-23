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
//   autoTrackProgress && !!autoTrackSuggestion && (Date.now() < autoSuppressUntilRef.current)
//
// This component test drives the three user-visible states directly
// (show=true, show=false, onResume click) without needing to mount the
// full 18k-line home.tsx component tree.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ManualOverrideBanner } from "./pages/home";

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
