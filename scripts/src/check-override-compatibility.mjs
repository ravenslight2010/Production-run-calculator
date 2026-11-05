#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const WORKSPACE_CONFIG_PATH = join(ROOT, "pnpm-workspace.yaml");
const LOCKFILE_PATH = join(ROOT, "pnpm-lock.yaml");
const VIRTUAL_STORE_PATH = join(ROOT, "node_modules/.pnpm");

function unquote(value) {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid quoted YAML scalar: ${value}`);
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

// pnpm's workspace and v9 lock files use simple YAML mappings for the
// sections consumed here. Fail closed on unknown mapping syntax instead of
// adding a parser dependency solely for this guard.
export function parseYamlMappings(source) {
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (const [lineNumber, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#") || line.trim() === "---") {
      continue;
    }
    const match = line.match(/^(\s*)(?:(?:'((?:[^']|'')*)'|"((?:\\.|[^"])*)"|([^:#][^:]*))):(?:\s*(.*))?$/);
    if (!match) {
      if (/^\s*-\s/.test(line)) continue;
      throw new Error(`Unsupported YAML mapping at line ${lineNumber + 1}`);
    }

    const indent = match[1].length;
    const key = match[2] !== undefined
      ? match[2].replaceAll("''", "'")
      : match[3] !== undefined
        ? unquote(`"${match[3]}"`)
        : match[4].trim();
    let rawValue = match[5] ?? "";
    if (rawValue && !rawValue.startsWith("'") && !rawValue.startsWith('"')) {
      rawValue = rawValue.replace(/\s+#.*$/, "").trim();
    }

    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1)?.value;
    if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
      throw new Error(`Invalid YAML nesting at line ${lineNumber + 1}`);
    }

    if (!rawValue) {
      const child = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = unquote(rawValue);
    }
  }

  return root;
}

function parsePackageId(id) {
  const nameEnd = id.startsWith("@")
    ? id.indexOf("/", 1) < 0
      ? -1
      : id.indexOf("@", id.indexOf("/", 1) + 1)
    : id.indexOf("@");
  if (nameEnd <= 0) return null;
  const name = id.slice(0, nameEnd);
  const rest = id.slice(nameEnd + 1);
  const version = rest.split(/[([]/, 1)[0];
  return /^\d+\.\d+\.\d+/.test(version) ? { name, version } : null;
}

function parseVersion(value) {
  const match = String(value).match(/(?:^|@)(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  return match
    ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
    : null;
}

function compareVersion(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
}

function partialVersion(value) {
  const normalized = value.replace(/-[0-9A-Za-z.-]+$/, "");
  const match = normalized.match(/^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/);
  if (!match) return null;
  const parts = match.slice(1);
  const values = parts.map((part) =>
    part === undefined || /^[xX*]$/.test(part) ? null : Number(part),
  );
  const firstWildcard = values.indexOf(null);
  if (firstWildcard >= 0 && values.slice(firstWildcard).some((part) => part !== null)) {
    return null;
  }
  return {
    values,
    precision: firstWildcard < 0 ? 3 : firstWildcard,
  };
}

function comparatorMatches(version, token) {
  const match = token.match(/^(<=|>=|<|>|~|\^)?(.+)$/);
  if (!match) return false;
  const operator = match[1] ?? "";
  const partial = partialVersion(match[2].trim());
  if (!partial) return false;
  const [major = 0, minor = 0, patch = 0] = partial.values;
  const floor = { major, minor, patch };

  if (operator === "^" || operator === "~") {
    if (compareVersion(version, floor) < 0) return false;
    let ceiling;
    if (operator === "~") {
      ceiling = partial.precision < 2
        ? { major: major + 1, minor: 0, patch: 0 }
        : { major, minor: minor + 1, patch: 0 };
    } else if (major > 0 || partial.precision < 2) {
      ceiling = { major: major + 1, minor: 0, patch: 0 };
    } else if (minor > 0 || partial.precision < 3) {
      ceiling = { major: 0, minor: minor + 1, patch: 0 };
    } else {
      ceiling = { major: 0, minor: 0, patch: patch + 1 };
    }
    return compareVersion(version, ceiling) < 0;
  }

  if (operator === ">=") return compareVersion(version, floor) >= 0;
  if (operator === ">") return compareVersion(version, floor) > 0;
  if (operator === "<=") return compareVersion(version, floor) <= 0;
  if (operator === "<") return compareVersion(version, floor) < 0;

  if (partial.precision === 0) return true;
  if (version.major !== major) return false;
  if (partial.precision === 1) return true;
  if (version.minor !== minor) return false;
  return partial.precision === 2 || version.patch === patch;
}

export function versionSatisfies(versionText, rangeText) {
  const version = parseVersion(versionText);
  if (!version || typeof rangeText !== "string") return null;
  const range = rangeText.trim();
  if (
    !range ||
    /^(?:workspace:|link:|file:|git\+|https?:|npm:|catalog:)/i.test(range)
  ) {
    return null;
  }
  if (range === "*" || /^[xX]$/.test(range)) return true;

  return range.split(/\s*\|\|\s*/).some((alternative) => {
    const trimmed = alternative.trim();
    const hyphen = trimmed.match(/^(\S+)\s+-\s+(\S+)$/);
    if (hyphen) {
      const lower = partialVersion(hyphen[1]);
      const upper = partialVersion(hyphen[2]);
      if (!lower || !upper) return false;
      const lowerBound = {
        major: lower.values[0] ?? 0,
        minor: lower.values[1] ?? 0,
        patch: lower.values[2] ?? 0,
      };
      const upperBound = {
        major: upper.values[0] ?? Number.MAX_SAFE_INTEGER,
        minor: upper.values[1] ?? Number.MAX_SAFE_INTEGER,
        patch: upper.values[2] ?? Number.MAX_SAFE_INTEGER,
      };
      return compareVersion(version, lowerBound) >= 0 &&
        compareVersion(version, upperBound) <= 0;
    }

    const tokens = trimmed.match(/(?:<=|>=|<|>|~|\^)?\s*(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?/g);
    if (!tokens || tokens.join("").replace(/\s/g, "") !== trimmed.replace(/\s/g, "")) {
      return false;
    }
    return tokens.every((token) => comparatorMatches(version, token.trim()));
  });
}

function splitPackageSelector(selector) {
  if (typeof selector !== "string" || !selector) return null;
  const nameEnd = selector.startsWith("@")
    ? selector.indexOf("/", 1) < 0
      ? -1
      : selector.indexOf("@", selector.indexOf("/", 1) + 1)
    : selector.indexOf("@");
  if (nameEnd < 0) return { name: selector, versionRange: null };
  return {
    name: selector.slice(0, nameEnd),
    versionRange: selector.slice(nameEnd + 1) || null,
  };
}

function parseOverride(key, value, catalog) {
  if (value === "-") return { key, excluded: true };
  if (typeof value !== "string") return { key, unsupported: true };

  let replacement = value;
  if (replacement.startsWith("catalog:")) {
    const catalogName = replacement.slice("catalog:".length);
    replacement = catalog[catalogName]?.[splitPackageSelector(key.split(">").at(-1))?.name];
  }
  if (
    typeof replacement !== "string" ||
    /^(?:npm:|workspace:|link:|file:|git\+|https?:)/i.test(replacement)
  ) {
    return { key, unsupported: true };
  }

  const selectors = key.split(">");
  if (selectors.length > 2) return { key, unsupported: true };
  const parentSelector = selectors.length === 2 ? selectors[0] : null;
  const targetSelector = selectors.at(-1);
  const target = splitPackageSelector(targetSelector);
  if (!target) return { key, unsupported: true };
  return {
    key,
    replacement,
    parent: parentSelector ? splitPackageSelector(parentSelector) : null,
    target,
  };
}

function packageVersionFromRef(name, reference) {
  if (typeof reference !== "string") return null;
  const aliased = reference.match(/^npm:(.+)$/);
  if (aliased) return parsePackageId(aliased[1]);
  const version = reference.match(/(?:^|@)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1];
  return version ? { name, version } : null;
}

function overrideMatches(override, parent, dependency, resolvedVersion) {
  if (override.excluded || override.unsupported) return false;
  if (override.target.name !== dependency) return false;
  if (override.parent) {
    if (override.parent.name !== parent.name) return false;
    if (
      override.parent.versionRange &&
      versionSatisfies(parent.version, override.parent.versionRange) !== true
    ) {
      return false;
    }
  }
  if (
    override.target.versionRange &&
    versionSatisfies(resolvedVersion, override.target.versionRange) !== true
  ) {
    return false;
  }
  return true;
}

function rangeIsExcludedByOverride(overrides, parent, dependency) {
  return overrides.some((override) =>
    override.excluded &&
    override.key.split(">").at(-1) === dependency &&
    (!override.key.includes(">") ||
      splitPackageSelector(override.key.split(">")[0])?.name === parent.name),
  );
}

function findPeerVersion(snapshotId, dependency) {
  const escapedName = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const peer = snapshotId.match(new RegExp(`\\(${escapedName}@([^()]*)\\)`));
  return peer?.[1]?.split(/[,(]/, 1)[0] ?? null;
}

const APPROVED_COMPATIBILITY_EXCEPTIONS = [
  {
    override: "@tailwindcss/typography>postcss-selector-parser",
    parent: "@tailwindcss/typography@0.5.20",
    dependency: "postcss-selector-parser",
    resolved: "7.1.6",
    declaredRange: "6.0.10",
    kind: "dependency",
    reason: "Owner-approved exact exception; shown as a compatibility caveat, not a supported-range claim.",
  },
  {
    override: "esbuild",
    parent: "drizzle-kit@0.31.11",
    dependency: "esbuild",
    resolved: "0.28.2",
    declaredRange: "^0.25.4",
    kind: "dependency",
    reason: "Owner-approved exact exception; shown as a compatibility caveat, not a supported-range claim.",
  },
  {
    override: "esbuild",
    parent: "esbuild-plugin-pino@2.3.3",
    dependency: "esbuild",
    resolved: "0.28.2",
    declaredRange: ">=0.25.0 <=0.25.8",
    kind: "peer dependency",
    reason: "Owner-approved exact exception; shown as a compatibility caveat, not a supported-range claim.",
  },
  {
    override: "adm-zip",
    parent: "github-actionlint@1.7.12",
    dependency: "adm-zip",
    resolved: "0.6.1",
    declaredRange: "^0.5.16",
    kind: "dependency",
    reason: "Owner-approved exact exception; shown as a compatibility caveat, not a supported-range claim.",
  },
  {
    override: "postcss",
    parent: "vite@8.3.4",
    dependency: "postcss",
    resolved: "8.5.23",
    declaredRange: "^8.5.29",
    kind: "dependency",
    reason: "Owner-approved exact exception; shown as a compatibility caveat, not a supported-range claim.",
  },
];

function addFinding(findings, approvedExceptions, override, parent, dependency, version, range, kind) {
  const actual = versionSatisfies(version, range);
  if (actual === false) {
    const finding = {
      override: override.key,
      parent: `${parent.name}@${parent.version}`,
      dependency,
      resolved: version,
      declaredRange: range,
      kind,
    };
    const approved = APPROVED_COMPATIBILITY_EXCEPTIONS.find((exception) =>
      Object.entries(finding).every(([key, value]) => exception[key] === value),
    );
    if (approved) {
      if (!approvedExceptions.some((exception) => exception.override === approved.override &&
        exception.parent === approved.parent &&
        exception.dependency === approved.dependency)) {
        approvedExceptions.push(approved);
      }
      return;
    }
    findings.push(finding);
  }
}

export function auditOverrideCompatibility({
  overrides: overrideEntries,
  lockfile,
  manifests = {},
  catalog = {},
}) {
  const findings = [];
  const approvedExceptions = [];
  const parsedOverrides = Object.entries(overrideEntries ?? {}).map(([key, value]) =>
    parseOverride(key, value, catalog),
  );
  let checked = 0;
  let excluded = parsedOverrides.filter((override) => override.excluded).length;
  const packageMetadata = lockfile.packages ?? {};
  const snapshots = lockfile.snapshots ?? {};

  for (const [snapshotId, snapshot] of Object.entries(snapshots)) {
    const parent = parsePackageId(snapshotId);
    if (!parent) continue;
    const metadataEntry = Object.entries(packageMetadata)
      .find(([packageId]) => {
        const parsed = parsePackageId(packageId);
        return parsed?.name === parent.name && parsed.version === parent.version;
      })?.[1] ?? {};
    const manifest = manifests[`${parent.name}@${parent.version}`] ?? {};
    const peerDependencies = {
      ...metadataEntry.peerDependencies,
      ...manifest.peerDependencies,
    };
    const optionalPeers = new Set(
      Object.entries(manifest.peerDependenciesMeta ?? metadataEntry.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta?.optional === true)
        .map(([name]) => name),
    );

    for (const [kind, names] of [
      ["dependency", manifest.dependencies ?? {}],
      ["optional dependency", manifest.optionalDependencies ?? {}],
      ["peer dependency", peerDependencies],
    ]) {
      for (const [dependency, range] of Object.entries(names)) {
        const resolvedReference =
          snapshot.dependencies?.[dependency] ??
          snapshot.optionalDependencies?.[dependency];
        const peerVersion = findPeerVersion(snapshotId, dependency);
        const resolved = packageVersionFromRef(
          dependency,
          resolvedReference ?? peerVersion,
        );
        if (!resolved) {
          if (
            optionalPeers.has(dependency) ||
            rangeIsExcludedByOverride(parsedOverrides, parent, dependency)
          ) {
            excluded += 1;
          }
          continue;
        }

        const relevant = parsedOverrides.filter((override) =>
          overrideMatches(override, parent, dependency, resolved.version),
        );
        for (const override of relevant) {
          if (override.excluded) {
            excluded += 1;
            continue;
          }
          const replacementMatches = versionSatisfies(
            resolved.version,
            override.replacement,
          );
          if (replacementMatches === false) {
            findings.push({
              override: override.key,
              parent: `${parent.name}@${parent.version}`,
              dependency,
              resolved: resolved.version,
              declaredRange: `override ${override.replacement}`,
              kind: "lockfile resolution",
            });
            continue;
          }
          if (versionSatisfies(resolved.version, range) === null) continue;
          checked += 1;
          addFinding(
            findings,
            approvedExceptions,
            override,
            parent,
            dependency,
            resolved.version,
            range,
            kind,
          );
        }
      }
    }
  }

  for (const [importerPath, importer] of Object.entries(lockfile.importers ?? {})) {
    const workspaceManifest = manifests[`importer:${importerPath}`] ?? {};
    const parent = {
      name: workspaceManifest.name ?? importerPath,
      version: workspaceManifest.version ?? "0.0.0",
    };
    for (const kind of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [dependency, entry] of Object.entries(importer[kind] ?? {})) {
        const resolved = packageVersionFromRef(dependency, entry.version);
        if (!resolved) continue;
        const relevant = parsedOverrides.filter((override) =>
          overrideMatches(override, parent, dependency, resolved.version),
        );
        for (const override of relevant) {
          if (override.excluded) {
            excluded += 1;
            continue;
          }
          const range = entry.specifier;
          if (versionSatisfies(resolved.version, override.replacement) === false) {
            findings.push({
              override: override.key,
              parent: `${parent.name}@${parent.version}`,
              dependency,
              resolved: resolved.version,
              declaredRange: `override ${override.replacement}`,
              kind: "lockfile resolution",
            });
          } else if (versionSatisfies(resolved.version, range) !== null) {
            checked += 1;
            addFinding(
              findings,
              approvedExceptions,
              override,
              parent,
              dependency,
              resolved.version,
              range,
              kind.slice(0, -1),
            );
          }
        }
      }
    }
  }

  return {
    findings,
    approvedExceptions,
    checked,
    excluded,
    skippedOverrides: parsedOverrides.filter((override) => override.unsupported).map((override) => override.key),
  };
}

function pnpmVirtualStoreBase(name, version) {
  const encodedName = name.startsWith("@")
    ? name.replace("/", "+")
    : name;
  return `${encodedName}@${version}`;
}

async function readInstalledManifests(lockfile) {
  const virtualStoreEntries = await readdir(VIRTUAL_STORE_PATH, {
    withFileTypes: true,
  }).catch(() => []);
  const manifests = {};
  const identities = new Map();

  for (const snapshotId of Object.keys(lockfile.snapshots ?? {})) {
    const identity = parsePackageId(snapshotId);
    if (!identity) continue;
    identities.set(
      `${identity.name}@${identity.version}`,
      { ...identity, base: pnpmVirtualStoreBase(identity.name, identity.version) },
    );
  }

  for (const entry of virtualStoreEntries) {
    if (!entry.isDirectory()) continue;
    for (const [identityKey, identity] of identities) {
      if (
        entry.name !== identity.base &&
        !entry.name.startsWith(`${identity.base}(`) &&
        !entry.name.startsWith(`${identity.base}_`)
      ) {
        continue;
      }
      const manifestPath = join(
        VIRTUAL_STORE_PATH,
        entry.name,
        "node_modules",
        ...identity.name.split("/"),
        "package.json",
      );
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        if (manifest.name === identity.name && manifest.version === identity.version) {
          manifests[identityKey] ??= manifest;
        }
      } catch {
        // Some optional packages are intentionally absent on this platform.
      }
    }
  }
  return manifests;
}

async function readWorkspaceManifests(lockfile) {
  const manifests = {};
  for (const importerPath of Object.keys(lockfile.importers ?? {})) {
    const packagePath = join(ROOT, importerPath === "." ? "" : importerPath, "package.json");
    try {
      manifests[`importer:${importerPath}`] = JSON.parse(
        await readFile(packagePath, "utf8"),
      );
    } catch {
      // A lockfile importer without a local manifest is not a workspace package.
    }
  }
  return manifests;
}

export async function main() {
  const [workspaceSource, lockfileSource] = await Promise.all([
    readFile(WORKSPACE_CONFIG_PATH, "utf8"),
    readFile(LOCKFILE_PATH, "utf8"),
  ]);
  const workspace = parseYamlMappings(workspaceSource);
  const lockfile = parseYamlMappings(lockfileSource);
  if (lockfile.lockfileVersion !== "9.0") {
    throw new Error(`Expected pnpm lockfile v9, found ${lockfile.lockfileVersion}`);
  }
  const manifests = {
    ...await readInstalledManifests(lockfile),
    ...await readWorkspaceManifests(lockfile),
  };
  const report = auditOverrideCompatibility({
    overrides: workspace.overrides,
    lockfile,
    manifests,
    catalog: { "": workspace.catalog ?? {} },
  });

  if (report.findings.length > 0) {
    console.error("Dependency override compatibility check failed:");
    for (const finding of report.findings) {
      console.error(
        `- ${finding.override}: ${finding.parent} resolves ${finding.dependency}@${finding.resolved}, outside ${finding.kind} range ${finding.declaredRange}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Dependency override compatibility check passed: ${report.checked} consumer edges checked; ${report.excluded} intentional optional exclusions or absent optional peers; ${report.approvedExceptions.length} exact existing compatibility exception(s); ${report.skippedOverrides.length} non-version override(s) not evaluated.`,
  );
  for (const exception of report.approvedExceptions) {
    console.log(
      `- ${exception.override}: ${exception.parent} resolves ${exception.dependency}@${exception.resolved} outside ${exception.kind} range ${exception.declaredRange} (${exception.reason})`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Dependency override compatibility check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
