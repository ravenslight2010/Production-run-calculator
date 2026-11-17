import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { factoryDirectoryState, factoryDirectoryVersion, subscribeFactoryDirectory } from "../factoryDirectory";
// Isolated reusable controls need no global repository. The authenticated app
// supplies this boundary; production readiness is always explicit.
const Ready = createContext(true);
export const useFactoryDirectoryReady = () => useContext(Ready);
export function FactoryDirectoryBoundary({ children }: { children: ReactNode }) {
  useSyncExternalStore(subscribeFactoryDirectory, factoryDirectoryVersion, factoryDirectoryVersion);
  return <Ready.Provider value={factoryDirectoryState().status === "ready"}>{children}</Ready.Provider>;
}
