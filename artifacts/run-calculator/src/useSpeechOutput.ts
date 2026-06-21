// Voice output for the "Ask about the day" chat — web platform glue.
//
// A thin React wrapper over the browser's SpeechSynthesis API
// (window.speechSynthesis / SpeechSynthesisUtterance). It reads AI replies
// aloud so a worker with full hands can hear the answer, completing the
// hands-free loop after a spoken question. Nothing about grounding or the
// answer text changes — this just narrates the text already on screen. When
// the API is missing we report that via `supported` so the UI hides the
// control and the worker reads the answer instead.
//
// Mirrors the mobile hook in
// artifacts/run-calculator-mobile/hooks/useSpeechOutput.ts (replit.md parity).
// The only difference is plumbing: the web app always has the DOM globals,
// while mobile guards on Platform.OS === "web".

import { useCallback, useEffect, useState } from "react";

// Minimal structural types for the Web Speech (synthesis) API, kept in step
// with the mobile mirror which has no DOM lib to lean on.
type SpeechSynthesisUtteranceLike = {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechSynthesisUtteranceCtor = new (text?: string) => SpeechSynthesisUtteranceLike;
type SpeechSynthesisLike = {
  speak: (u: SpeechSynthesisUtteranceLike) => void;
  cancel: () => void;
  readonly speaking: boolean;
  readonly paused: boolean;
};

function getSynth(): {
  synth: SpeechSynthesisLike;
  Utterance: SpeechSynthesisUtteranceCtor;
} | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    speechSynthesis?: SpeechSynthesisLike;
    SpeechSynthesisUtterance?: SpeechSynthesisUtteranceCtor;
  };
  if (!w.speechSynthesis || !w.SpeechSynthesisUtterance) return null;
  return { synth: w.speechSynthesis, Utterance: w.SpeechSynthesisUtterance };
}

export function speechOutputSupported(): boolean {
  return getSynth() !== null;
}

export function useSpeechOutput({
  lang = "en-US",
}: {
  lang?: string;
} = {}): {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  cancel: () => void;
} {
  const supported = speechOutputSupported();
  const [speaking, setSpeaking] = useState(false);

  const cancel = useCallback(() => {
    const got = getSynth();
    if (got) {
      try {
        got.synth.cancel();
      } catch {
        /* already idle */
      }
    }
    setSpeaking(false);
  }, []);

  // Stop any in-flight narration on unmount (e.g. leaving the tab).
  useEffect(() => {
    return () => {
      const got = getSynth();
      if (got) {
        try {
          got.synth.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      const got = getSynth();
      if (!got) return;
      // Replace whatever is currently being read; only the latest reply matters.
      try {
        got.synth.cancel();
      } catch {
        /* ignore */
      }
      let utt: SpeechSynthesisUtteranceLike;
      try {
        utt = new got.Utterance(t);
      } catch {
        setSpeaking(false);
        return;
      }
      utt.lang = lang;
      utt.onend = () => setSpeaking(false);
      utt.onerror = () => setSpeaking(false);
      setSpeaking(true);
      try {
        got.synth.speak(utt);
      } catch {
        setSpeaking(false);
      }
    },
    [lang],
  );

  return { supported, speaking, speak, cancel };
}
