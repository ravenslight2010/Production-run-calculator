import { type ReactNode } from "react";
import { Lock } from "lucide-react";

/**
 * Wraps the SetupRecipes tab editing surface with a supervisor role gate.
 *
 * When `isSupervisor` is false the fieldset is disabled (all contained
 * form controls become inert) and a lock banner is shown above it.
 * When `isSupervisor` is true the fieldset is fully interactive.
 *
 * Exported separately so it can be tested in isolation without mounting
 * the full LiveSetupRecipesTabContent component.
 */
export function SetupRecipesRoleGate({
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
          data-testid="setup-recipes-lock-banner"
          className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-xs text-muted-foreground"
        >
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Supervisor access required to edit these settings
        </div>
      )}
      <fieldset
        data-testid="setup-recipes-fieldset"
        disabled={!isSupervisor}
        className={!isSupervisor ? "opacity-60 pointer-events-none" : ""}
      >
        {children}
      </fieldset>
    </>
  );
}
