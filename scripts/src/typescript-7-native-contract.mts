export type Typescript7ApprovedRunner = {
  platform: string;
  arch: string;
  nativePackage: string;
  releaseJobs: readonly string[];
};

export const TYPESCRIPT_7_SUPPORTED_RUNNERS = [
  {
    platform: "linux",
    arch: "x64",
    nativePackage: "@typescript/typescript-linux-x64",
    releaseJobs: [
      "ci.yml:typescript-7-codegen-bridge",
      "release-check.yml:release-check-standard",
      "release-check.yml:release-check-full",
    ],
  },
] as const satisfies readonly Typescript7ApprovedRunner[];

const NATIVE_PACKAGE_PATTERN =
  /^  '(@typescript\/typescript-[^@']+)@([^']+)':\s*$/gmu;
const SNAPSHOT_PACKAGE_PATTERN =
  /^\s{6}'(@typescript\/typescript-[^']+)':\s+([^ \r\n]+)\s*$/gmu;

function lockfileSection(lockfile: string, section: string): string {
  const start = lockfile.indexOf(`${section}:\n`);
  if (start < 0) {
    throw new Error(`pnpm-lock.yaml is missing the ${section} section.`);
  }
  const nextSection = lockfile
    .slice(start + section.length + 2)
    .search(/\n(?:packages|snapshots):\n/u);
  const end =
    nextSection < 0
      ? -1
      : start + section.length + 2 + nextSection + 1;
  return lockfile.slice(start, end < 0 ? lockfile.length : end);
}

export function typescript7NativePackagesFromLockfile(
  lockfile: string,
  candidateVersion: string,
): string[] {
  if (!/^\d+\.\d+\.\d+$/u.test(candidateVersion)) {
    throw new Error(`Invalid TypeScript 7 candidate version: ${candidateVersion}`);
  }

  const packagesSection = lockfileSection(lockfile, "packages");
  const packageVersions = new Map<string, string>();
  for (const match of packagesSection.matchAll(NATIVE_PACKAGE_PATTERN)) {
    const [, name, version] = match;
    if (packageVersions.has(name)) {
      throw new Error(`pnpm-lock.yaml contains duplicate ${name} package records.`);
    }
    packageVersions.set(name, version);
  }

  const snapshotSection = lockfileSection(lockfile, "snapshots");
  const optionalPackages = new Map<string, string>();
  const typescriptSnapshotStart = snapshotSection.indexOf(
    `  typescript@${candidateVersion}:\n`,
  );
  if (typescriptSnapshotStart < 0) {
    throw new Error(
      `pnpm-lock.yaml is missing the typescript@${candidateVersion} snapshot.`,
    );
  }
  const typescriptSnapshot = snapshotSection.slice(typescriptSnapshotStart);
  const nextSnapshot = typescriptSnapshot.indexOf("\n\n  ", 1);
  const optionalDependencyBlock =
    nextSnapshot < 0
      ? typescriptSnapshot
      : typescriptSnapshot.slice(0, nextSnapshot);
  for (const match of optionalDependencyBlock.matchAll(
    SNAPSHOT_PACKAGE_PATTERN,
  )) {
    const [, name, version] = match;
    if (optionalPackages.has(name)) {
      throw new Error(
        `pnpm-lock.yaml contains duplicate optional dependency ${name}.`,
      );
    }
    optionalPackages.set(name, version);
  }

  if (packageVersions.size === 0 || optionalPackages.size === 0) {
    throw new Error(
      "pnpm-lock.yaml does not enumerate TypeScript 7 native optional packages.",
    );
  }

  const packageNames = [...packageVersions.keys()].sort();
  const optionalNames = [...optionalPackages.keys()].sort();
  if (
    packageNames.length !== optionalNames.length ||
    packageNames.some((name, index) => name !== optionalNames[index])
  ) {
    throw new Error(
      "pnpm-lock.yaml native package records and TypeScript 7 optional dependencies differ.",
    );
  }
  for (const name of packageNames) {
    if (packageVersions.get(name) !== candidateVersion) {
      throw new Error(
        `pnpm-lock.yaml pins ${name} to ${packageVersions.get(name)}, expected ${candidateVersion}.`,
      );
    }
    if (optionalPackages.get(name) !== candidateVersion) {
      throw new Error(
        `typescript@${candidateVersion} optionally resolves ${name} to ${optionalPackages.get(name)}, expected ${candidateVersion}.`,
      );
    }
  }
  return packageNames;
}

export function approvedTypescript7Runner(
  platform: string,
  arch: string,
): Typescript7ApprovedRunner {
  const runner = TYPESCRIPT_7_SUPPORTED_RUNNERS.find(
    (candidate) =>
      candidate.platform === platform && candidate.arch === arch,
  );
  if (!runner) {
    const supported = TYPESCRIPT_7_SUPPORTED_RUNNERS.map(
      (candidate) => `${candidate.platform}/${candidate.arch}`,
    ).join(", ");
    throw new Error(
      `TypeScript 7 native runner ${platform}/${arch} is not approved; refusing to use a fallback binary. Approved runners: ${supported}.`,
    );
  }
  return runner;
}