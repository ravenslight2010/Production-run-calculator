import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupExpiredApplyLogExports } from "./distill-applylog-retention.mts";

function parseArgs(args: string[]): string {
  if (args.length !== 2 || args[0] !== "--directory" || !args[1] || args[1].startsWith("--")) {
    throw new Error("Usage: distill:cleanup-applylog-exports -- --directory PRIVATE_DIRECTORY");
  }
  return args[1];
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
  try {
    const result = await cleanupExpiredApplyLogExports({
      directory: parseArgs(process.argv.slice(2)),
      repoRoot,
    });
    console.log(
      `Private Apply export cleanup complete: ${result.expiredExportsRemoved} expired exports removed, ` +
      `${result.unexpiredExportsRetained} retained, ${result.invalidMarkersSkipped} invalid markers skipped, ` +
      `${result.deletionFailures} deletion failures.`,
    );
  } catch {
    console.error("Private Apply export cleanup failed; no file details were logged.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}