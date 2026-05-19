"use client";
/**
 * Web Speech API wrapper.
 * Returns null in environments without support (SSR, older browsers).
 */

interface SpeechRecognitionEvent extends Event {
  results: { 0: { transcript: string }; isFinal: boolean; length: number }[] & { length: number };
  resultIndex: number;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SRCtor = new () => SpeechRecognitionLike;

export const isVoiceSupported = (): boolean => {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
};

export interface VoiceListener {
  start: () => void;
  stop: () => void;
}

export const createVoiceRecognition = (opts: {
  lang?: "mn-MN" | "en-US";
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (msg: string) => void;
  onEnd?: () => void;
}): VoiceListener | null => {
  if (!isVoiceSupported()) return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  const Ctor: SRCtor = (w.SpeechRecognition ?? w.webkitSpeechRecognition)!;
  const rec = new Ctor();
  rec.lang = opts.lang ?? "mn-MN";
  rec.continuous = false;
  rec.interimResults = true;

  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += transcript;
      else interim += transcript;
    }
    if (interim) opts.onPartial?.(interim);
    if (final) opts.onFinal?.(final.trim());
  };
  rec.onerror = (e) => opts.onError?.((e as unknown as { error?: string }).error || "voice-error");
  rec.onend = () => opts.onEnd?.();

  return {
    start: () => { try { rec.start(); } catch { /* already started */ } },
    stop: () => { try { rec.stop(); } catch { /* not running */ } },
  };
};
