import OpenAI from "openai";

const apiKey =
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY must be set. Please add your OpenAI API key to Secrets.",
  );
}

const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };

if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  clientOptions.baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
}

export const openai = new OpenAI(clientOptions);
