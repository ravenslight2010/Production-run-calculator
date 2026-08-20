import { describe, expect, it } from "vitest"

import { reducer } from "./use-toast"

function addToast(
  id: string,
  persistent = false,
  action?: unknown
) {
  return {
    type: "ADD_TOAST" as const,
    toast: {
      id,
      open: true,
      title: id,
      persistent,
      action: action as never,
    },
  }
}

describe("toast reducer", () => {
  it("keeps the reload toast available when an ordinary toast follows it", () => {
    const reloadAction = { label: "Reload now" }
    const updateReady = reducer(
      { toasts: [] },
      addToast("update-ready", true, reloadAction)
    )
    const ordinaryToast = reducer(updateReady, addToast("profile-saved"))

    expect(ordinaryToast.toasts).toHaveLength(2)
    expect(ordinaryToast.toasts.map((toast) => toast.id)).toEqual([
      "profile-saved",
      "update-ready",
    ])
    expect(ordinaryToast.toasts[1].persistent).toBe(true)
    expect(ordinaryToast.toasts[1].action).toBe(reloadAction)

    const afterDismissAll = reducer(ordinaryToast, {
      type: "DISMISS_TOAST",
    })
    expect(afterDismissAll.toasts).toEqual([
      expect.objectContaining({ id: "profile-saved", open: false }),
      expect.objectContaining({
        id: "update-ready",
        open: true,
        action: reloadAction,
      }),
    ])
  })
})