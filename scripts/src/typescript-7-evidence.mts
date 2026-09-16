export type DiagnosticCommand = {
  name: string;
  diagnostics: string[];
};

export const releaseRevisionGitArgs = [
  "log",
  "-1",
  "--format=%H",
  "--",
  ".",
  ":(exclude)release-evidence",
  ":(exclude)release-evidence/**",
  ":(exclude)release-evidence-full",
  ":(exclude)release-evidence-full/**",
] as const;

export function diagnosticsEqualForPairs(
  commands: readonly DiagnosticCommand[],
  checks: readonly string[],
): boolean {
  const byName = new Map(commands.map((command) => [command.name, command]));
  return checks.every((check) => {
    const baseline = byName.get(`typescript-6-${check}`)?.diagnostics;
    const candidate = byName.get(`typescript-7-${check}`)?.diagnostics;
    return (
      baseline !== undefined &&
      candidate !== undefined &&
      JSON.stringify(baseline) === JSON.stringify(candidate)
    );
  });
}