// Mixes chat assistant (web).
//
// A staff-facing, single-shot Q&A grounded in the current mixes — explain a mix,
// total an ingredient, compare amounts. Advisory only: the server returns an
// answer plus an optional note and never a structured apply, so this never writes
// anything. Mirrors the mobile component in
// artifacts/run-calculator-mobile/components/MixAssistChat.tsx (replit.md parity).

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askMixAssistant, type MixAssistAnswer } from "@/mixAssist";

type Turn = { question: string; answer: string; note?: string };

export default function MixAssistChat() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);

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
    <Card data-testid="mix-assist-chat">
      <CardHeader>
        <CardTitle className="text-base">Ask about Mixes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ask a question about your mixes — how much of an ingredient a mix uses, what's in a
          mix, or how two mixes compare.
        </p>

        {turns.length > 0 ? (
          <div className="space-y-3">
            {turns.map((t, i) => (
              <div key={i} className="space-y-1" data-testid={`mix-assist-turn-${i}`}>
                <div className="text-sm font-medium">{t.question}</div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{t.answer}</p>
                {t.note ? (
                  <p className="text-xs italic text-muted-foreground">{t.note}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask();
            }}
            placeholder="e.g. How much mozzarella does the cheese mix use?"
            disabled={busy}
            data-testid="input-mix-assist-question"
          />
          <Button
            onClick={() => void ask()}
            disabled={busy || question.trim().length === 0}
            data-testid="button-mix-assist-ask"
          >
            {busy ? "Asking…" : "Ask"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
