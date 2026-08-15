/**
 * ManualOverrideBanner — amber banner shown while a manual stepper override
 * is holding auto-track writes back.
 *
 * Extracted from pages/home.tsx so that home.tsx only exports React
 * components (Fast Refresh requirement). Both the predicate and the
 * component are imported by home.tsx; the test suite imports them here.
 */
import { fmtMins } from "../utils";

/**
 * Computes the `show` prop for ManualOverrideBanner from the three conditions
 * that must ALL be true: auto-track is on, a suggestion exists, and the
 * manual-override suppression window is still active.
 *
 * Exported so tests import this exact function — any future change to the
 * conditions here (adding/removing a term) will automatically be reflected in
 * the tests without needing a separate in-test copy of the formula.
 */
export function manualOverrideBannerShow(
  autoTrackProgress: boolean,
  autoTrackSuggestion: unknown,
  autoSuppressUntilRefCurrent: number,
): boolean {
  return (
    autoTrackProgress &&
    !!autoTrackSuggestion &&
    Date.now() < autoSuppressUntilRefCurrent
  );
}

/**
 * Amber banner shown while a manual stepper override is holding auto-track
 * writes back. Renders nothing when `show` is false (suppression window
 * inactive, auto-track disabled, or no suggestion available). Exported so
 * it can be rendered directly in component tests without mounting the full
 * LivePackagingTabContent / LiveDoughTabContent tree.
 */
export function ManualOverrideBanner({
  show,
  minsLeft,
  onResume,
}: {
  show: boolean;
  minsLeft: number;
  onResume: () => void;
}) {
  if (!show) return null;
  return (
    <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-amber-950/20 border border-amber-600/20 text-[10px] text-left" data-testid="manual-override-banner">
      <span className="text-amber-400 font-semibold">
        Manual override active · auto resumes in ~{fmtMins(minsLeft)}
      </span>
      <button
        type="button"
        onClick={onResume}
        className="text-amber-400 hover:text-amber-300 font-semibold ml-2 shrink-0"
        data-testid="btn-resume-now"
      >
        Resume now
      </button>
    </div>
  );
}
