import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const REVIEWED_REPORT_SHA256 =
  "1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294";
export const INPUT_SECRET_NAME = "SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64";
export const REPORT_DIRECTORY = "attached_assets/source-library/audits";
export const REPORT_BASENAME = "source-library-reconciliation-2026-08-26";
const MAX_ENCODED_BYTES = 48_000;
const MAX_REPORT_BYTES = 1024 * 1024;

// The CLI always uses the reviewed pin above. An explicit pin makes fixture-only
// unit tests possible without putting operational report contents in Git.
export function decodeReviewedReport(encoded, expectedSha256) {
  if (typeof encoded !== "string" || !encoded.length) {
    throw new Error(`Missing protected ${INPUT_SECRET_NAME} input.`);
  }
  if (encoded.length > MAX_ENCODED_BYTES ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("Protected report encoding is invalid or oversized.");
  }
  const compressed = Buffer.from(encoded, "base64");
  if (compressed.toString("base64") !== encoded) {
    throw new Error("Protected report encoding is not canonical.");
  }
  let report;
  try {
    report = gunzipSync(compressed, { maxOutputLength: MAX_REPORT_BYTES });
  } catch {
    throw new Error("Protected report compression is invalid or exceeds its budget.");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? "") ||
      createHash("sha256").update(report).digest("hex") !== expectedSha256) {
    throw new Error("Protected report does not match the reviewed SHA-256.");
  }
  return report;
}

function safeDirectory(root, create) {
  let directory = realpathSync(root);
  for (const component of REPORT_DIRECTORY.split("/")) {
    directory = path.join(directory, component);
    let stat;
    try {
      stat = lstatSync(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!create) return null;
      mkdirSync(directory, { mode: 0o700 });
      stat = lstatSync(directory);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Reviewed input directories must not be symlinks or non-directories.");
    }
  }
  return directory;
}

function expectedFiles(directory, report, expectedSha256) {
  return [
    [path.join(directory, `${REPORT_BASENAME}.json`), report],
    [path.join(directory, `${REPORT_BASENAME}.sha256`), Buffer.from(`${expectedSha256}\n`)],
  ];
}

function verifyExisting(files) {
  return files.map(([file, expected]) => {
    let stat;
    try {
      stat = lstatSync(file);
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || !readFileSync(file).equals(expected)) {
      throw new Error("Existing reviewed input is unsafe or differs from approved bytes.");
    }
    return true;
  });
}

export function restoreReviewedBuildInputs(root, encoded, expectedSha256 = REVIEWED_REPORT_SHA256) {
  const report = decodeReviewedReport(encoded, expectedSha256);
  const directory = safeDirectory(root, true);
  const files = expectedFiles(directory, report, expectedSha256);
  const existing = verifyExisting(files);
  files.forEach(([file, bytes], index) => {
    if (!existing[index]) writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    chmodSync(file, 0o600);
  });
}

export function cleanupReviewedBuildInputs(root) {
  const directory = safeDirectory(root, false);
  if (!directory) return;
  const reportPath = path.join(directory, `${REPORT_BASENAME}.json`);
  if (!existsSync(reportPath)) {
    // Never delete an unverified orphan checksum.
    if (existsSync(path.join(directory, `${REPORT_BASENAME}.sha256`))) {
      throw new Error("Cannot clean up an incomplete reviewed input pair.");
    }
    return;
  }
  if (!lstatSync(reportPath).isFile() || lstatSync(reportPath).isSymbolicLink()) {
    throw new Error("Cannot clean up an unsafe reviewed report.");
  }
  const report = readFileSync(reportPath);
  if (createHash("sha256").update(report).digest("hex") !== REVIEWED_REPORT_SHA256) {
    throw new Error("Cannot clean up a report that differs from reviewed bytes.");
  }
  const files = expectedFiles(directory, report, REVIEWED_REPORT_SHA256);
  const existing = verifyExisting(files);
  files.forEach(([file], index) => { if (existing[index]) unlinkSync(file); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const encoded = process.env[INPUT_SECRET_NAME];
  delete process.env[INPUT_SECRET_NAME];
  try {
    if (process.argv.length === 2) restoreReviewedBuildInputs(process.cwd(), encoded);
    else if (process.argv.length === 3 && process.argv[2] === "--cleanup") {
      cleanupReviewedBuildInputs(process.cwd());
    } else throw new Error("Expected no arguments or --cleanup.");
    console.log("Reviewed CI build input verification completed.");
  } catch (error) {
    console.error(`Reviewed CI build inputs: ${error.message}`);
    process.exitCode = 1;
  }
}
