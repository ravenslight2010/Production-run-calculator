/** Thin client for the generic durable server-job contract. */
export type ServerJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  progressMessage: string | null;
  result: unknown;
  error: { code: string; message: string | null } | null;
};

const POLL_MS = 750;
const JOB_TIMEOUT_MS = 8 * 60_000;

export async function submitAndWaitForServerJob<T>(args: {
  type: "workbook-parse" | "workbook-reconcile" | "export-package";
  input: unknown;
  snapshotId?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const idempotencyKey = crypto.randomUUID();
  const created = await fetch("/api/server-jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: args.type, input: args.input, snapshotId: args.snapshotId, idempotencyKey }),
    signal: args.signal,
  });
  if (!created.ok) throw new Error(`Server job submission failed (${created.status})`);
  const first = await created.json() as ServerJob;
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let job = first;
  while (job.status === "queued" || job.status === "running") {
    if (args.signal?.aborted) throw args.signal.reason ?? new DOMException("Job cancelled", "AbortError");
    if (Date.now() > deadline) throw new Error("Server job did not finish in time");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_MS);
      args.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(args.signal?.reason); }, { once: true });
    });
    const response = await fetch(`/api/server-jobs/${encodeURIComponent(job.id)}`, { signal: args.signal });
    if (!response.ok) throw new Error(`Server job polling failed (${response.status})`);
    job = await response.json() as ServerJob;
  }
  if (job.status !== "succeeded") throw new Error(job.error?.message ?? `Server job ${job.status}`);
  return job.result as T;
}