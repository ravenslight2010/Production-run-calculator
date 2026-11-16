import { createContext, useContext } from "react";
import type { UpdateState } from "../pwaUpdateCoordinator";

export type AppUpdateContextValue = {
  state: UpdateState;
  check: () => void;
  update: () => void;
  cancelUpdate: () => void;
  autoReloadSafe: boolean;
  autoReloadIdle: boolean;
  developmentPreview: boolean;
  updateAndReload: (
    canReload?: () => boolean,
    verifyBeforeReload?: () => Promise<boolean>,
  ) => Promise<void>;
  scheduleSafeIdleRecovery: (
    safeAtFailure: boolean,
    recover: (canReload: () => boolean) => void | Promise<void>,
  ) => () => void;
};

export const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function useAppUpdateContext(): AppUpdateContextValue {
  const value = useContext(AppUpdateContext);
  if (!value) throw new Error("App update controls must be rendered inside AppUpdatePrompt.");
  return value;
}
