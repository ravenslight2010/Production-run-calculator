import { useRef } from "react";

/**
 * Keeps a dropdown list's scroll position stable across re-renders while open.
 * Returns stable `listRef` and `onScroll` handlers to attach to the list element.
 */
export function useDropdownScrollKeeper(open: boolean) {
  const posRef = useRef(0);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current) posRef.current = 0;
  wasOpenRef.current = open;
  const handlersRef = useRef({
    listRef: (node: HTMLDivElement | null) => {
      if (node && posRef.current > 0 && node.scrollTop !== posRef.current) {
        node.scrollTop = posRef.current;
      }
    },
    onScroll: (e: { currentTarget: HTMLDivElement }) => {
      posRef.current = e.currentTarget.scrollTop;
    },
  });
  return handlersRef.current;
}
