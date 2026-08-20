export interface SyncWriteResponseBody<T> {
  data?: T;
  stale?: boolean;
  epoch?: number;
}

interface ConsumeSyncWriteResponseOptions<T> {
  applyCanonical?: (data: T) => void | Promise<void>;
  onStale?: (body: SyncWriteResponseBody<T>) => void | Promise<void>;
  shouldConsume?: () => boolean;
}

export async function consumeSyncWriteResponse<T>(
  response: Response,
  options: ConsumeSyncWriteResponseOptions<T> = {},
): Promise<{ body: SyncWriteResponseBody<T> | null; stale: boolean }> {
  const parsed = await response.clone().json().catch(() => null);
  const body =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SyncWriteResponseBody<T>
      : null;
  if (options.shouldConsume && !options.shouldConsume()) {
    return { body, stale: false };
  }
  const stale = body?.stale === true;

  if (stale) {
    await options.onStale?.(body);
  } else if (response.ok && body?.data !== undefined) {
    await options.applyCanonical?.(body.data);
  }

  return { body, stale };
}