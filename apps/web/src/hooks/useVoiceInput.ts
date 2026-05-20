// Browser-native dictation wrapper. Paseo ships a much heavier
// sherpa-onnx ASR stack in its daemon; we start with the browser's
// built-in SpeechRecognition because it is zero-install, available in
// Chromium-based shells (including Electron), and routes through the
// same code path on both desktop and web. When we later want offline
// or higher-quality ASR, swap this hook's body for a daemon-side
// streaming endpoint without touching the composers.
//
// Two listeners surface:
//   - `partial` — interim transcript, used to show a ghost preview in
//     the composer while the user is still speaking.
//   - `final` — committed transcript chunk, appended to the draft.

import { useCallback, useEffect, useRef, useState } from 'react';

type RecognitionStatus = 'idle' | 'starting' | 'listening' | 'error';

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Show the mic button whenever the constructor exists. Electron's
// OSS build lacks Google's ASR key and so `start()` fails on click,
// but the previous "hide in Electron" branch surprised users who
// expected the affordance to be there. Now we always render the
// button and surface the daemon's / browser's actual error if click
// goes wrong — the inline error message in `MicButton` is the right
// place to communicate degraded state.
export function isVoiceInputAvailable(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export interface UseVoiceInputOptions {
  // BCP-47 language tag. Defaults to navigator.language so Chinese users
  // get zh-CN out of the box and English users get en-US, without us
  // shipping an explicit setting.
  lang?: string;
  // Called with each committed chunk. Use this to append to a draft.
  onCommit: (text: string) => void;
  // Called with the latest interim transcript, including the in-progress
  // utterance. Replaces previous interim (not appended).
  onInterim?: (text: string) => void;
}

export interface UseVoiceInputApi {
  status: RecognitionStatus;
  available: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  errorMessage: string | null;
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputApi {
  const { onCommit, onInterim, lang } = options;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [status, setStatus] = useState<RecognitionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const onCommitRef = useRef(onCommit);
  const onInterimRef = useRef(onInterim);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    onInterimRef.current = onInterim;
  }, [onInterim]);

  const available = isVoiceInputAvailable();

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }, []);

  const start = useCallback(() => {
    if (!available) {
      setErrorMessage('Voice input is not available in this browser.');
      setStatus('error');
      return;
    }
    if (status === 'listening' || status === 'starting') return;
    setErrorMessage(null);
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setErrorMessage('Voice input is not available in this browser.');
      setStatus('error');
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    rec.onstart = () => setStatus('listening');
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const result = ev.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          if (transcript.trim().length > 0) {
            onCommitRef.current(transcript);
          }
        } else {
          interim += transcript;
        }
      }
      if (onInterimRef.current) onInterimRef.current(interim);
    };
    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      setErrorMessage(ev.message ?? ev.error ?? 'voice input error');
      setStatus('error');
    };
    rec.onend = () => {
      setStatus('idle');
      onInterimRef.current?.('');
    };
    setStatus('starting');
    try {
      rec.start();
      recognitionRef.current = rec;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [available, lang, status]);

  const toggle = useCallback(() => {
    if (status === 'listening' || status === 'starting') stop();
    else start();
  }, [status, start, stop]);

  return { status, available, start, stop, toggle, errorMessage };
}
