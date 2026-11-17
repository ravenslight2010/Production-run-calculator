export function shouldEnableBackgroundCapacityTelemetry(
  env: Record<string, string | undefined>,
): boolean {
  return env.DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS !== "1" ||
    env.ENABLE_BACKGROUND_CAPACITY_TELEMETRY === "1";
}
