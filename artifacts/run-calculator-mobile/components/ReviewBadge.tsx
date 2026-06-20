import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import type { ReviewVerdict } from "@workspace/ai-review";

// Reviewer-AI "second set of eyes" flag. Advisory only — it never blocks
// applying a suggestion, it just warns the user when a second AI pass thinks a
// suggestion is risky (warn) or likely wrong/unsafe (reject). An "ok" verdict or
// a missing verdict (reviewer unavailable / fail-safe) renders nothing. Mirrors
// the web ReviewBadge in artifacts/run-calculator/src/components/ReviewBadge.tsx.
export default function ReviewBadge({ review }: { review?: ReviewVerdict }) {
  const colors = useColors();
  if (!review || review.status === "ok") return null;

  const isReject = review.status === "reject";
  const tint = isReject ? colors.destructive : colors.warning;
  const label = isReject ? "Likely wrong" : "Double-check";

  return (
    <View
      style={[
        styles.wrap,
        { borderColor: `${tint}66`, backgroundColor: `${tint}1a` },
      ]}
    >
      <Feather
        name={isReject ? "alert-octagon" : "alert-triangle"}
        size={13}
        color={tint}
        style={styles.icon}
      />
      <Text style={[styles.text, { color: tint }]}>
        <Text style={styles.label}>{label.toUpperCase()}</Text>
        {review.reason ? ` — ${review.reason}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    fontFamily: FONTS.regular,
    fontSize: 11,
    lineHeight: 15,
  },
  label: {
    fontFamily: FONTS.bold,
  },
});
