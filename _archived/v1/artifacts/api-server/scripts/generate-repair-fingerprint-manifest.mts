import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { registeredAutomaticDataHeals } from "../src/lib/dataHeals";
import { renderReleasedRepairFingerprintManifest } from "../src/lib/repairDefinitionFingerprintManifest";

const output = renderReleasedRepairFingerprintManifest(
  registeredAutomaticDataHeals().list(),
);
const write = process.argv.slice(2).includes("--write");

if (write) {
  const manifestUrl = new URL(
    "../src/lib/repairDefinitionFingerprints.manifest.ts",
    import.meta.url,
  );
  await writeFile(fileURLToPath(manifestUrl), output, "utf8");
  console.log(`Updated ${fileURLToPath(manifestUrl)}`);
} else {
  process.stdout.write(output);
}