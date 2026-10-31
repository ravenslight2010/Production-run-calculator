import type { captureReleaseIdentity } from "./release-source-identity.mjs";

type Identity = ReturnType<typeof captureReleaseIdentity>;
type RunnerBudgets = { timeoutMs: number | null; warningMs: number | null };
type Lane = "chromium-full" | "webkit-smoke" | "webkit-compatibility" | "webkit-compatibility-debug";
type Case = { id: string; identity: string; projectName?: string; timeoutMs: number; retries: number };
type Event = { retry: number; workerIndex: number; startTime: Date };
type Result = Event & {
  duration: number;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
};
type Config = {
  workers: number;
  globalTimeout: number;
  projects: { name: string; timeout: number; retries: number }[];
};
export function atomicWriteBrowserMetadata(path: string, bytes: string): void;
export function startBrowserAttempt(options: {
  root: string; lane?: Lane; identity?: Identity; runnerBudgets?: RunnerBudgets; now?: () => number;
}): string;
export function claimBrowserAttempt(options: {
  root: string; lane?: Lane; attemptId: string; identity: Identity; now?: () => number;
  write?: typeof atomicWriteBrowserMetadata;
}): {
  begin(cases: Case[], config: Config): void;
  testBegin(id: string, event: Event): void;
  testEnd(id: string, result: Result): void;
  error(): void;
  end(result: "passed" | "failed" | "timedout" | "interrupted",
    currentIdentity: Identity, complete: boolean): boolean;
};
