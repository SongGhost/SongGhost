"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionResultLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0?: { transcript?: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type UseVoiceSearchOptions = {
  onTranscript: (text: string) => void;
};

export type UseVoiceSearchResult = {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
};

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser-built-in voice dictation via the Web Speech API.
 * Fail closed: never throws to the UI.
 */
export function useVoiceSearch({
  onTranscript,
}: UseVoiceSearchOptions): UseVoiceSearchResult {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const clearRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      // Fail closed — abort can throw if already stopped.
    }
  }, []);

  const stop = useCallback(() => {
    clearRecognition();
    setListening(false);
  }, [clearRecognition]);

  const start = useCallback(() => {
    try {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setError("Voice search is not supported in this browser");
        setListening(false);
        return;
      }

      clearRecognition();
      setError(null);

      const recognition = new Ctor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event) => {
        try {
          let transcript = "";
          let isFinal = false;
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (!result) continue;
            transcript += result[0]?.transcript ?? "";
            if (result.isFinal) isFinal = true;
          }
          const text = transcript.trim();
          if (!isFinal || !text) return;
          onTranscriptRef.current(text);
          recognitionRef.current = null;
          recognition.onresult = null;
          recognition.onerror = null;
          recognition.onend = null;
          try {
            recognition.abort();
          } catch {
            // Already finished.
          }
          setListening(false);
        } catch {
          setError("Voice search failed");
          setListening(false);
          clearRecognition();
        }
      };

      recognition.onerror = (event) => {
        const code = event.error?.trim() ?? "";
        if (code === "aborted") {
          setListening(false);
          return;
        }
        setError(code || "Voice search failed");
        setListening(false);
        clearRecognition();
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
        setListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      setError("Voice search failed");
      setListening(false);
      clearRecognition();
    }
  }, [clearRecognition]);

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionCtor()));
  }, []);

  useEffect(() => () => clearRecognition(), [clearRecognition]);

  return { supported, listening, start, stop, error };
}
