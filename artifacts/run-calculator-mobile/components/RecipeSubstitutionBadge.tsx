import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import type { IngredientSubstitution } from "@workspace/inventory-math";
import { describeSubstitution } from "./SubstitutionsManager";

type RecipeRow = { ingredient?: string };

// Shows which active day-state substitutions touch the recipes/types on the
// currently-viewed run, so floor staff know the printed recipe is overlaid for
// today. Read-only badge — managing substitutions lives in the Inventory tab.
// Mobile mirror of web's RecipeSubstitutionBadge.
export default function RecipeSubstitutionBadge({
  substitutions,
  recipes,
  typeValues,
}: {
  substitutions: IngredientSubstitution[];
  recipes: (RecipeRow[] | undefined)[];
  typeValues: (string | undefined)[];
}) {
  const colors = useColors();
  if (substitutions.length === 0) return null;

  const present = new Set<string>();
  for (const rows of recipes)
    for (const r of rows ?? []) if (r?.ingredient) present.add(r.ingredient.toLowerCase());
  for (const t of typeValues) if (t) present.add(t.toLowerCase());

  const relevant = substitutions.filter((s) => present.has(s.ingredient.toLowerCase()));
  if (relevant.length === 0) return null;

  const amber = colors.warning;
  const amberBg = "rgba(245,158,11,0.12)";
  const amberBorder = "rgba(245,158,11,0.4)";

  return (
    <View style={[styles.box, { backgroundColor: amberBg, borderColor: amberBorder }]}>
      <View style={styles.header}>
        <Feather name="repeat" size={13} color={amber} />
        <Text style={[styles.headerText, { color: amber }]}>TODAY&apos;S SUBSTITUTIONS</Text>
      </View>
      <View style={styles.chips}>
        {relevant.map((s) => (
          <View
            key={s.id}
            style={[styles.chip, { backgroundColor: amberBg, borderColor: amberBorder }]}
          >
            <Text style={[styles.chipText, { color: amber }]}>{describeSubstitution(s)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  headerText: { fontSize: 11, letterSpacing: 0.5, fontFamily: FONTS.semibold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 11, fontFamily: FONTS.medium },
});
