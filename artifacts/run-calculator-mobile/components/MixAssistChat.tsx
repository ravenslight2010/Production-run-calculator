// Mixes chat assistant (mobile).
//
// A staff-facing, single-shot Q&A grounded in the current mixes — explain a mix,
// total an ingredient, compare amounts. Advisory only: the server returns an
// answer plus an optional note and never a structured apply, so this never writes
// anything. Mirrors the web component in
// artifacts/run-calculator/src/components/MixAssistChat.tsx (replit.md parity).

import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { askMixAssistant, type MixAssistAnswer } from "@/context/mixAssist";

type Turn = { question: string; answer: string; note?: string };

export default function MixAssistChat() {
  const colors = useColors();
  const [question, setQuestion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [turns, setTurns] = React.useState<Turn[]>([]);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res: MixAssistAnswer = await askMixAssistant(q);
      setTurns((prev) => [...prev, { question: q, answer: res.answer, note: res.note }]);
      setQuestion("");
    } catch {
      setError("Couldn't get an answer right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
        Ask a question about your mixes — how much of an ingredient a mix uses,
        what&apos;s in a mix, or how two mixes compare.
      </Text>

      {turns.length > 0 ? (
        <View style={{ gap: 10 }}>
          {turns.map((t, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text style={{ fontSize: 13, fontFamily: FONTS.medium, color: colors.foreground }}>
                {t.question}
              </Text>
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{t.answer}</Text>
              {t.note ? (
                <Text
                  style={{
                    fontSize: 12,
                    fontStyle: "italic",
                    color: colors.mutedForeground,
                  }}
                >
                  {t.note}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {error ? <Text style={{ fontSize: 13, color: colors.destructive }}>{error}</Text> : null}

      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => void ask()}
          editable={!busy}
          placeholder="e.g. How much mozzarella does the cheese mix use?"
          placeholderTextColor={colors.mutedForeground}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontFamily: FONTS.regular,
            fontSize: 13,
            color: colors.foreground,
            backgroundColor: colors.background,
          }}
        />
        <Pressable
          onPress={() => void ask()}
          disabled={busy || question.trim().length === 0}
          style={({ pressed }) => ({
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: colors.primary,
            opacity: busy || question.trim().length === 0 || pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ fontFamily: FONTS.bold, fontSize: 13, color: colors.primaryForeground }}>
            {busy ? "Asking…" : "Ask"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
