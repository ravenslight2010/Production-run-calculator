import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Page, TestInfo } from "@playwright/test";

export async function attachVisualEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const image = await page.screenshot({ type: "jpeg", quality: 75 });
  await testInfo.attach(name, { body: image, contentType: "image/jpeg" });

  const configuredDirectory = process.env.TASK3722_VISUAL_CAPTURE_DIR;
  if (!configuredDirectory) return;

  const temporaryRoot = resolve(tmpdir());
  const captureDirectory = resolve(configuredDirectory);
  if (!captureDirectory.startsWith(`${temporaryRoot}${sep}`)) {
    throw new Error("Visual evidence must be written beneath the system temporary directory.");
  }

  await mkdir(captureDirectory, { recursive: true });
  const fileName = `${name.replace(/[^a-z0-9._-]/gi, "-")}.jpg`;
  await writeFile(join(captureDirectory, fileName), image);
}
