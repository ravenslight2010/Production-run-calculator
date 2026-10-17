import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isGeminiProviderConfigured,
  MODEL_FALLBACKS,
  probeGeminiModel,
} from "@workspace/integrations-openai-ai-server";

export type GeminiFallbackAvailability = {
  rung: number;
  model: string;
  available: boolean;
};

export async function checkGeminiFallbackAvailability(
  models: readonly string[],
  probe: (model: string) => Promise<void>,
): Promise<GeminiFallbackAvailability[]> {
  const results: GeminiFallbackAvailability[] = [];
  for (const [index, model] of models.entries()) {
    try {
      await probe(model);
      results.push({ rung: index + 1, model, available: true });
    } catch {
      // Provider errors may contain request details; report only rung and
      // availability, never the error body or generated content.
      results.push({ rung: index + 1, model, available: false });
    }
  }
  return results;
}

export async function main(): Promise<void> {
  if (!isGeminiProviderConfigured()) {
    throw new Error(
      "Gemini credentials are not configured; set AI_INTEGRATIONS_GEMINI_API_KEY or GOOGLE_API_KEY.",
    );
  }

  const results = await checkGeminiFallbackAvailability(
    MODEL_FALLBACKS,
    probeGeminiModel,
  );
  process.stdout.write(`${JSON.stringify(results)}\n`);
  if (results.some((result) => !result.available)) process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown failure";
    process.stderr.write(
      `Gemini fallback availability check failed: ${message}\n`,
    );
    process.exitCode = 1;
  });
}
