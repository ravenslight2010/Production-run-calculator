// Mixes chat assistant — web platform glue.
//
// A staff-facing, single-shot Q&A grounded strictly in the current mixes: explain
// a mix, total an ingredient across mixes, compare amounts. Advisory only — the
// server returns an answer plus an optional note and NEVER a structured apply (a
// deliberate scoping decision); nothing here writes anything. Mirrors the mobile
// glue in artifacts/run-calculator-mobile/context/mixAssist.ts (replit.md parity).

import type { Mix } from "@workspace/mixes";
import { fetchMixes } from "./mixes";
import { inventoryClientId } from "./inventoryShared";

export type MixAssistMixContext = {
  name: string;
  brand: string;
  flavor: string;
  batchSize: number;
  daysEarly: number;
  amountAlreadyMade: number;
  enabled: boolean;
  components: { ingredient: string; perPizza: number }[];
};

export type MixAssistAnswer = {
  answer: string;
  generatedAt: number;
  note?: string;
};

/** Reduce the full Mix list to the lean shape the assistant endpoint expects. */
export function buildMixAssistContext(mixes: ReadonlyArray<Mix>): MixAssistMixContext[] {
  return mixes.map((m) => ({
    name: m.name,
    brand: m.brand,
    flavor: m.flavor,
    batchSize: m.batchSize,
    daysEarly: m.daysEarly,
    amountAlreadyMade: m.amountAlreadyMade,
    enabled: m.enabled,
    components: m.components.map((c) => ({ ingredient: c.ingredient, perPizza: c.perPizza })),
  }));
}

/** Ask the Mixes assistant a question grounded in the current mixes. */
export async function askMixAssistant(question: string): Promise<MixAssistAnswer> {
  const mixes = await fetchMixes();
  const res = await fetch("/api/ai/mix-assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": inventoryClientId(),
    },
    body: JSON.stringify({ question, mixes: buildMixAssistContext(mixes) }),
  });
  if (!res.ok) throw new Error(`Mix assistant failed (${res.status})`);
  return (await res.json()) as MixAssistAnswer;
}
