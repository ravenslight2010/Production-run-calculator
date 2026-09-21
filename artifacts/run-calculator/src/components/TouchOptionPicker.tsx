import * as React from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { useIsTouchDevice } from "../hooks/use-mobile";
import { cn } from "@/lib/utils";

export type TouchOption = {
  value: string;
  label: React.ReactNode;
  searchText?: string;
  disabled?: boolean;
};

const SEARCH_THRESHOLD = 8;

function optionText(label: React.ReactNode): string {
  return React.Children.toArray(label)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("");
}

function makeChangeEvent(value: string): React.ChangeEvent<HTMLSelectElement> {
  const target = document.createElement("select");
  const option = document.createElement("option");
  option.value = value;
  target.append(option);
  target.value = value;
  const event = new Event("change", { bubbles: true }) as unknown as React.ChangeEvent<HTMLSelectElement>;
  Object.defineProperty(event, "target", { value: target });
  Object.defineProperty(event, "currentTarget", { value: target });
  return event;
}

export function TouchOptionPicker({
  value,
  options,
  onValueChange,
  placeholder = "Select…",
  title = "Select an option",
  disabled = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  id,
  "data-testid": dataTestId,
  onAddOption,
  onRemoveOption,
}: {
  value: string;
  options: readonly TouchOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  id?: string;
  "data-testid"?: string;
  onAddOption?: (value: string) => void;
  onRemoveOption?: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchable = options.length >= SEARCH_THRESHOLD || Boolean(onAddOption);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const currentLabel = selected?.label ?? placeholder;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        (option.searchText ?? optionText(option.label)).toLocaleLowerCase().includes(normalizedQuery),
      )
    : options;

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setConfirmDelete(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const onOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setQuery("");
      setConfirmDelete(null);
      setOpen(true);
    } else {
      close();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <button
        ref={triggerRef}
        id={id}
        data-testid={dataTestId}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background/50 px-3 py-2 text-left text-sm outline-none transition-colors focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>{currentLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <DialogContent
        aria-modal="true"
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b border-border/60 px-5 pb-4 pt-5 pr-12 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Current selection: {selected ? optionText(selected.label) : placeholder}
          </DialogDescription>
        </DialogHeader>

        {searchable && (
          <div className="border-b border-border/60 px-5 py-3">
            <label className="sr-only" htmlFor={`${id ?? "touch-option"}-search`}>
              Search {title}
            </label>
            <input
              id={`${id ?? "touch-option"}-search`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={onAddOption ? "Search or add…" : "Search options…"}
              autoFocus
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        <div
          role="listbox"
          aria-label={title}
          aria-activedescendant={selected ? `${id ?? "touch-option"}-${selectedIndex}` : undefined}
          className="min-h-0 max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain px-3 py-2"
          data-testid={dataTestId ? `${dataTestId}-options` : "touch-option-picker-options"}
        >
          {filteredOptions.map((option, index) => {
            const optionIndex = options.indexOf(option);
            const isSelected = optionIndex === selectedIndex;
            if (confirmDelete === option.value) {
              return (
                <div key={`${option.value}-${optionIndex}`} className="flex min-h-14 items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-destructive">
                    Remove “{optionText(option.label)}”?
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="min-h-10 rounded-md bg-destructive px-3 text-sm font-semibold text-destructive-foreground"
                      onClick={() => {
                        onRemoveOption?.(option.value);
                        close();
                      }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className="min-h-10 rounded-md bg-muted px-3 text-sm font-semibold text-muted-foreground"
                      onClick={() => setConfirmDelete(null)}
                    >
                      No
                    </button>
                  </span>
                </div>
              );
            }

            return (
              <div key={`${option.value}-${optionIndex}`} className="flex items-center gap-1">
                <button
                  id={`${id ?? "touch-option"}-${optionIndex}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-3 text-left text-base outline-none transition-colors hover:bg-muted focus:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    onValueChange(option.value);
                    close();
                  }}
                >
                  <span className={cn("truncate", isSelected && "font-semibold text-primary")}>{option.label}</span>
                  {isSelected && <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
                </button>
                {onRemoveOption && (
                  <button
                    type="button"
                    aria-label={`Remove ${optionText(option.label)}`}
                    className="min-h-11 min-w-11 rounded-md px-2 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmDelete(option.value)}
                  >
                    <X className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}

          {filteredOptions.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching options.</p>
          )}

          {onAddOption && query.trim() && !options.some((option) => option.value === query.trim()) && (
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-2 rounded-md px-3 text-left text-base font-semibold text-primary hover:bg-muted focus:bg-muted"
              onClick={() => {
                const newValue = query.trim();
                onAddOption(newValue);
                onValueChange(newValue);
                close();
              }}
            >
              <Plus className="h-5 w-5" aria-hidden="true" /> Add “{query.trim()}”
            </button>
          )}
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <DialogClose asChild>
            <button type="button" className="min-h-11 w-full rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              Cancel
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function optionsFromChildren(children: React.ReactNode): TouchOption[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child) || child.type !== "option") return [];
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const label = props.children ?? props.value ?? "";
    return [{
      value: props.value == null ? optionText(label) : String(props.value),
      label,
      searchText: optionText(label),
      disabled: props.disabled,
    }];
  });
}

export function TouchSelect({
  children,
  onChange,
  value,
  className,
  disabled,
  title,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "children"> & {
  children: React.ReactNode;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  title?: string;
}) {
  const isTouchDevice = useIsTouchDevice();
  const options = React.useMemo(() => optionsFromChildren(children), [children]);
  const dialogTitle = title ?? props["aria-label"] ?? "Select an option";

  if (!isTouchDevice) {
    return (
      <select {...props} value={value} onChange={onChange} className={className} disabled={disabled}>
        {children}
      </select>
    );
  }

  return (
    <TouchOptionPicker
      {...props}
      value={String(value ?? "")}
      options={options}
      title={dialogTitle}
      disabled={disabled}
      className={className}
      onValueChange={(nextValue) => onChange?.(makeChangeEvent(nextValue))}
    />
  );
}