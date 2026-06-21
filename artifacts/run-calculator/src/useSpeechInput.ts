// Voice input for the "Ask about the day" chat — web platform glue.
//
// A thin React wrapper over the browser's Web Speech API
// (SpeechRecognition / webkitSpeechRecognition). It transcribes microphone
// speech to text; the caller drops that text into the existing chat input and
// sends it through the normal /ai/ask flow (no change to grounding/answer
// logic). When the API is missing or the mic permission is denied we report
// that via `state`/`supported` so the UI falls back to plain typing.
//
// Mirrors the mobile hook in
// artifacts/run-calculator-mobile/hooks/useSpeechInput.ts (replit.md parity).
// The only difference is plumbing: the web app always has the DOM globals,
// while mobile guards on Platform.OS === "web".

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechState = "unsupported" | "idle" | "listening" | "denied" | "error";

// Minimal structural types for the Web Speech API (not in lib.dom.d.ts).
type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};
type SpeechRecognitionResultListLike = {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
};
type SpeechRecognitionEventLike = {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
};
type SpeechRecognitionErrorEventLike = { readonly error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export function useSpeechInput({
  onTranscript,
  lang = "en-US",
}: {
  // Called as speech is recognized. `isFinal` marks the last (settled) result
  // of an utterance; interim calls let the input update live as the user talks.
  onTranscript: (text: string, isFinal: boolean) => void;
  lang?: string;
}): {
  state: SpeechState;
  supported: boolean;
  listening: boolean;
  toggle: () => void;
  stop: () => void;
} {
  const supported = speechSupported();
  const [state, setState] = useState<SpeechState>(supported ? "idle" : "unsupported");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Keep the latest callback without re-creating the recognition instance.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
  }, []);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
        recRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setState("unsupported");
      return;
    }
    // Don't start twice.
    if (recRef.current) return;
    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      setState("error");
      return;
    }
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i];
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) final += alt.transcript;
        else interim += alt.transcript;
      }
      const text = (final || interim).trim();
      if (text) onTranscriptRef.current(text, Boolean(final));
    };
    rec.onerror = (e) => {
      const err = e.error;
      if (err === "not-allowed" || err === "service-not-allowed") setState("denied");
      else if (err === "no-speech" || err === "aborted") setState("idle");
      else setState("error");
    };
    rec.onend = () => {
      recRef.current = null;
      // Returning to idle (unless a terminal error/denied state was set).
      setState((s) => (s === "listening" ? "idle" : s));
    };
    recRef.current = rec;
    setState("listening");
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setState("error");
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (recRef.current) stop();
    else start();
  }, [supported, start, stop]);

  return {
    state,
    supported,
    listening: state === "listening",
    toggle,
    stop,
  };
}
