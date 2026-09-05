import {
  Component,
  lazy,
  useMemo,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import type InventoryTab from "../components/InventoryTab";
import type MixesManager from "../components/MixesManager";
import type ProductionRulesManager from "../components/ProductionRulesManager";
import type FreezerPullItemsManager from "../components/FreezerPullItemsManager";
import type CycleCountManager from "../components/CycleCountManager";
import type CheeseRecipesManager from "../components/CheeseRecipesManager";
import type DieLineDefaultsManager from "../components/DieLineDefaultsManager";
import type NamedRecipesManager from "../components/NamedRecipesManager";

type ModuleLoader<T extends ComponentType<any>> = () => Promise<{ default: T }>;

type DeferredSurfaceProps<T extends ComponentType<any>> = {
  label: string;
  load: ModuleLoader<T>;
  componentProps: ComponentProps<T>;
};

type RetryBoundaryProps = {
  label: string;
  onRetry: () => void;
  children: ReactNode;
};

type RetryBoundaryState = { error: Error | null };

class DeferredRetryBoundary extends Component<RetryBoundaryProps, RetryBoundaryState> {
  state: RetryBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RetryBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-5 text-center"
        role="alert"
      >
        <p className="text-sm font-medium">Couldn’t load {this.props.label}.</p>
        <p className="text-xs text-muted-foreground">
          Check the connection and try this section again. Your saved work is not affected.
        </p>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
          onClick={() => {
            this.setState({ error: null });
            this.props.onRetry();
          }}
        >
          Retry {this.props.label}
        </button>
      </div>
    );
  }
}

function DeferredSurface<T extends ComponentType<any>>({
  label,
  load,
  componentProps,
}: DeferredSurfaceProps<T>) {
  const [attempt, setAttempt] = useState(0);
  const LazySurface = useMemo(() => lazy(load), [load, attempt]);

  return (
    <DeferredRetryBoundary
      key={attempt}
      label={label}
      onRetry={() => setAttempt((current) => current + 1)}
    >
      <div aria-live="polite">
        <LazySurface {...componentProps} />
      </div>
    </DeferredRetryBoundary>
  );
}

const loadInventoryTab: ModuleLoader<typeof InventoryTab> = () =>
  import("../components/InventoryTab");
const loadMixesManager: ModuleLoader<typeof MixesManager> = () =>
  import("../components/MixesManager");
const loadProductionRulesManager: ModuleLoader<typeof ProductionRulesManager> = () =>
  import("../components/ProductionRulesManager");
const loadFreezerPullItemsManager: ModuleLoader<typeof FreezerPullItemsManager> = () =>
  import("../components/FreezerPullItemsManager");
const loadCycleCountManager: ModuleLoader<typeof CycleCountManager> = () =>
  import("../components/CycleCountManager");
const loadCheeseRecipesManager: ModuleLoader<typeof CheeseRecipesManager> = () =>
  import("../components/CheeseRecipesManager");
const loadDieLineDefaultsManager: ModuleLoader<typeof DieLineDefaultsManager> = () =>
  import("../components/DieLineDefaultsManager");
const loadNamedRecipesManager: ModuleLoader<typeof NamedRecipesManager> = () =>
  import("../components/NamedRecipesManager");

export function preloadWarehouseInventorySurface(): void {
  void loadInventoryTab().catch(() => {});
}

export function preloadManagementEditors(): void {
  void Promise.all([
    loadProductionRulesManager(),
    loadFreezerPullItemsManager(),
    loadCycleCountManager(),
    loadCheeseRecipesManager(),
    loadDieLineDefaultsManager(),
    loadNamedRecipesManager(),
    loadMixesManager(),
  ]).catch(() => {});
}

export function DeferredInventoryTab(props: ComponentProps<typeof InventoryTab>) {
  return (
    <DeferredSurface
      label="Inventory"
      load={loadInventoryTab}
      componentProps={props}
    />
  );
}

export function DeferredMixesManager(props: ComponentProps<typeof MixesManager>) {
  return (
    <DeferredSurface
      label="mix management"
      load={loadMixesManager}
      componentProps={props}
    />
  );
}

export function DeferredProductionRulesManager(
  props: ComponentProps<typeof ProductionRulesManager>,
) {
  return (
    <DeferredSurface
      label="production rules"
      load={loadProductionRulesManager}
      componentProps={props}
    />
  );
}

export function DeferredFreezerPullItemsManager(
  props: ComponentProps<typeof FreezerPullItemsManager>,
) {
  return (
    <DeferredSurface
      label="freezer pull items"
      load={loadFreezerPullItemsManager}
      componentProps={props}
    />
  );
}

export function DeferredCycleCountManager(
  props: ComponentProps<typeof CycleCountManager>,
) {
  return (
    <DeferredSurface
      label="cycle-count schedules"
      load={loadCycleCountManager}
      componentProps={props}
    />
  );
}

export function DeferredCheeseRecipesManager(
  props: ComponentProps<typeof CheeseRecipesManager>,
) {
  return (
    <DeferredSurface
      label="cheese recipes"
      load={loadCheeseRecipesManager}
      componentProps={props}
    />
  );
}

export function DeferredDieLineDefaultsManager(
  props: ComponentProps<typeof DieLineDefaultsManager>,
) {
  return (
    <DeferredSurface
      label="die defaults"
      load={loadDieLineDefaultsManager}
      componentProps={props}
    />
  );
}

export function DeferredNamedRecipesManager(
  props: ComponentProps<typeof NamedRecipesManager>,
) {
  return (
    <DeferredSurface
      label="named recipes"
      load={loadNamedRecipesManager}
      componentProps={props}
    />
  );
}