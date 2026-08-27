/** Shared React Query key for manager-facing run suggestions. */
export const RUN_SUGGESTIONS_QUERY_KEY = ["run-suggestions"] as const;

/** Product-scoped key so switching reviewed runs cannot reuse another product's rows. */
export function runSuggestionsQueryKey(brand: string, flavor: string) {
  return [
    ...RUN_SUGGESTIONS_QUERY_KEY,
    brand.trim().toLowerCase(),
    flavor.trim().toLowerCase(),
  ] as const;
}