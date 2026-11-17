import type { ImportFormat } from "@workspace/spec-import/import-preflight";

/** Lightweight metadata: importing this list must not load XLSX or parsers. */
export const IMPORT_TEMPLATES: ReadonlyArray<{ format: ImportFormat; label: string; description: string }> = [
  { format: "spec", label: "Pizza spec", description: "Product table; sauce, applicator and pepperoni amounts in oz per pizza." },
  { format: "premix", label: "Premix", description: "Recipe blocks; separate oz per pizza and lbs per batch columns." },
  { format: "cheese", label: "Cheese recipe", description: "Recipe blocks; ingredient weights in lbs per batch." },
  { format: "shipping", label: "Shipping guide", description: "Packaging table; pizza and case counts, not ingredient weights." },
  { format: "sauce", label: "Sauce guide", description: "Product-to-sauce mapping sentences; oz per pizza, not batch lbs." },
  { format: "dough", label: "Dough guide", description: "Product-to-dough mapping sentences; no ingredient weights." },
  { format: "schedule", label: "Production schedule", description: "Dated day-block table; ISO date in the header and planned case counts." },
];
