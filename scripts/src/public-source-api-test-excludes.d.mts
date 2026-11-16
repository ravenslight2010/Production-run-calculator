export const SOURCE_LIBRARY_RECONCILIATION_REPORT_RELATIVE: string;

export const PUBLIC_SOURCE_API_TEST_EXCLUDES: readonly string[];

export type PublicSourceApiTestExcludeOptions = {
  env?: NodeJS.ProcessEnv;
  root?: string;
  exists?: (path: string) => boolean;
};

export function isPublicCiSource(env?: NodeJS.ProcessEnv): boolean;

export function publicSourceApiTestExcludes(
  options?: PublicSourceApiTestExcludeOptions,
): string[];

export function vitestPublicSourceExcludeArgs(
  options?: PublicSourceApiTestExcludeOptions,
): string[];

export function warnPublicSourceApiTestExcludes(
  excludes: readonly string[],
  log?: (...args: unknown[]) => void,
): void;
