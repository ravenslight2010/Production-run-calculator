import { type ReactNode } from "react";
import { Lock } from "lucide-react";

/**
 * Wraps the Run tab's "Line Setup" editing surface with a supervisor role gate.
 *
 * When `isSupervisor` is false a lock banner is shown and the fieldset is
 * disabled (all contained form controls become inert).
 * When `isSupervisor` is true the fieldset is fully interactive.
 *
 * Exported separately so it can be tested in isolation without mounting
 * the full LiveRunTabContent component.
 */
export function LineSetupRoleGate({
  isSupervisor,
  children,
}: {
  isSupervisor: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {!isSupervisor && (
        <div
          data-testid="line-setup-lock-banner"
          className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-xs text-muted-foreground"
        >
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Supervisor access required to edit line settings
        </div>
      )}
      <fieldset
        data-testid="line-setup-role-gate-fieldset"
        disabled={!isSupervisor}
        className="contents"
      >
        {children}
      </fieldset>
    </>
  );
}
