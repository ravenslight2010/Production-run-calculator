import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import {
  DEFAULT_RUN_TO_TIME,
  formatRunToTimeInput,
  parseRunToTimeInput,
} from "../../runToTime";

interface RunToTimeControlProps {
  value: string;
  onCommit: (value: string) => void;
}

export function RunToTimeControl({ value, onCommit }: RunToTimeControlProps) {
  const id = useId();
  const editingRef = useRef(false);
  const [draft, setDraft] = useState(() => formatRunToTimeInput(value));
  const [error, setError] = useState("");

  useEffect(() => {
    if (editingRef.current) return;
    setDraft(formatRunToTimeInput(value));
    setError("");
  }, [value]);

  const commitDraft = () => {
    const normalized = parseRunToTimeInput(draft);
    if (!normalized) {
      setError("Enter a time like 7:15 PM or 19:15.");
      return;
    }
    setError("");
    setDraft(formatRunToTimeInput(normalized));
    onCommit(normalized);
  };

  const setDefault = () => {
    setError("");
    setDraft(formatRunToTimeInput(DEFAULT_RUN_TO_TIME));
    onCommit(DEFAULT_RUN_TO_TIME);
  };

  return (
    <div className="flex w-full min-w-0 flex-none flex-col items-stretch gap-2 sm:min-w-[14rem] sm:flex-1 sm:flex-row sm:items-start">
      <div className="w-full min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">
          Run until time, such as 7:15 PM or 19:15
        </label>
        <input
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          value={draft}
          placeholder="7:15 PM"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={(event) => {
            editingRef.current = true;
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onBlur={() => {
            editingRef.current = false;
            commitDraft();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          className="h-12 w-full min-w-0 rounded-md border border-input bg-background px-3 font-mono text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:text-sm"
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="button-run-to-time-default"
        onPointerDown={(event) => event.preventDefault()}
        onClick={setDefault}
        className="h-11 w-full shrink-0 whitespace-nowrap sm:w-auto"
      >
        Set default · {formatRunToTimeInput(DEFAULT_RUN_TO_TIME)}
      </Button>
    </div>
  );
}
