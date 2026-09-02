import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const e2eDirectory = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(e2eDirectory))
  .filter((file) => file.endsWith(".spec.ts"))
  .sort();
const failures = [];

for (const file of files) {
  const source = await readFile(join(e2eDirectory, file), "utf8");
  const normalized = source.replace(/\s+/g, " ");

  if (
    (source.includes("#accessCode") || /page\.goto\(\s*["']\/sign-up/.test(source)) &&
    !source.includes("signUpAndHandleOnboarding")
  ) {
    failures.push(
      `${file}: browser sign-up must use signUpAndHandleOnboarding from onboarding.ts`,
    );
  }

  if (
    /(?:getStarted(?:Btn)?|completionButton|onboardingCompletionButton)\s*\.\s*click\s*\(/i.test(
      normalized,
    )
  ) {
    failures.push(
      `${file}: onboarding completion must use dismissOnboardingIfPresent/completeOnboarding`,
    );
  }

  if (
    /getByRole\(\s*["']button["']\s*,\s*\{\s*name\s*:\s*[^}]*get\s*\.?\s*started[^}]*\}\s*\)\s*\.\s*click\s*\(/i.test(
      normalized,
    )
  ) {
    failures.push(
      `${file}: direct Get started clicks bypass the checked onboarding helper`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Onboarding guard passed for ${files.length} browser spec files.`);