/**
 * Typography tokens mirroring the sibling web artifact (artifacts/run-calculator).
 * Web uses Inter for UI text and Space Mono for numeric / data values.
 *
 * React Native does not map numeric `fontWeight` onto custom font families, so
 * each weight must reference its own loaded family. Use `interFor(weight)` to
 * resolve a weight string/number to the correct Inter family, or reference the
 * named families directly via `FONTS`.
 */
export const FONTS = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  mono: "SpaceMono_400Regular",
  monoBold: "SpaceMono_700Bold",
} as const;

export function interFor(weight?: string | number): string {
  const w =
    typeof weight === "number" ? weight : parseInt(String(weight ?? "400"), 10);
  if (w >= 700) return FONTS.bold;
  if (w >= 600) return FONTS.semibold;
  if (w >= 500) return FONTS.medium;
  return FONTS.regular;
}
