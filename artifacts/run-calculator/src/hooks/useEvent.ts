import { useCallback, useRef } from "react";

/**
 * Returns an action whose identity never changes while its implementation
 * always observes the latest render. This is useful for narrow context
 * providers: dialog-only Home renders do not notify consumers, but actions
 * still use current form, run, and authorization state when invoked.
 */
export function useEvent<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((...args: Args): Result => handlerRef.current(...args), []);
}