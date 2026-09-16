export type RuntimeEnvironment = Record<string, string | undefined>;

const TRUTHY = new Set(["1", "true", "yes"]);

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

/**
 * A Replit deployment marker is stronger than REPLIT_ENVIRONMENT. Isolated
 * workspaces can report REPLIT_ENVIRONMENT=production, so that label alone
 * must never classify a workspace as a deployed runtime.
 */
export function isConfirmedProductionRuntime(
  environment: RuntimeEnvironment,
): boolean {
  return Boolean(environment.REPLIT_DEPLOYMENT_ID?.trim())
    || isTruthy(environment.REPLIT_DEPLOYMENT);
}