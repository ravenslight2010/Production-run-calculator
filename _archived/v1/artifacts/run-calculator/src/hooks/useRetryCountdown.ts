import { useCallback, useRef, useState } from "react";
import { useVisibilityAwareInterval } from "./useVisibilityAwareInterval";

export function useRetryCountdown(): [number, (seconds: number) => void] {
  const [retryIn, setRetryInState] = useState(0);
  const expiresAtRef = useRef(0);

  const setRetryIn = useCallback((seconds: number) => {
    const boundedSeconds = Math.max(0, seconds);
    expiresAtRef.current = boundedSeconds > 0
      ? Date.now() + boundedSeconds * 1_000
      : 0;
    setRetryInState(boundedSeconds);
  }, []);

  useVisibilityAwareInterval(
    () => {
      const remaining = Math.max(
        0,
        Math.ceil((expiresAtRef.current - Date.now()) / 1_000),
      );
      setRetryInState(remaining);
      if (remaining === 0) expiresAtRef.current = 0;
    },
    1_000,
    retryIn > 0,
  );

  return [retryIn, setRetryIn];
}