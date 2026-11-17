// ── Manual mock for ../../hooks/useNotifications ──────────────────────────────
//
// PURPOSE
// -------
// Single authoritative source of truth for the useNotifications mock used
// across all test files that exercise LiveRunProvider.  Activate with:
//
//   vi.mock("../../hooks/useNotifications");
//
// STRUCTURAL GUARANTEE
// --------------------
// setShowBatchDue is allocated once at module scope.  Every call to
// useNotifications() returns the SAME function reference.  This is mandatory
// because LiveRunProvider's liveSlice useMemo includes setShowBatchDue in its
// deps — an inline vi.fn() in the return body would produce a new reference on
// every render, defeating the memo and corrupting nowTime propagation.

import { vi } from "vitest";
import type { UseNotificationsReturn } from "../useNotifications";

export const mockSetShowBatchDue: UseNotificationsReturn["setShowBatchDue"] = vi.fn();
export const mockSetShowPaceAlert: UseNotificationsReturn["setShowPaceAlert"] = vi.fn();

export function useNotifications(): UseNotificationsReturn {
  return {
    showBatchDue: false,
    setShowBatchDue: mockSetShowBatchDue,
    showPaceAlert: false,
    setShowPaceAlert: mockSetShowPaceAlert,
    paceAlertMsg: "",
  };
}
