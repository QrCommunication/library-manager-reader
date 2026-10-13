export interface SpeechOptions { language: string; rate: number; onDone: () => void }
export interface SpeechService {
  speak(text: string, opts: SpeechOptions): void;
  stop(): void;
  pause(): void;
  resume(): void;
  speaking(): Promise<boolean>;
}

type ExpoSpeechModule = {
  speak(text: string, options: { language: string; rate: number; onDone: () => void; onError?: () => void }): void;
  stop(): void;
  pause(): void;
  resume(): void;
  isSpeakingAsync(): Promise<boolean>;
};

// expo-speech expects a BCP-47 tag. fr/en are the only UI languages (fr-FR / en-US);
// a book may carry any ISO code, so a bare 2-letter code gets a region appended,
// anything longer (e.g. 'pt-BR') is passed through untouched.
const toSpeechLanguage = (language: string): string => {
  if (language === 'fr') return 'fr-FR';
  if (language === 'en') return 'en-US';
  return /^[a-z]{2}$/.test(language) ? `${language}-${language.toUpperCase()}` : language;
};

export function createExpoSpeechService(Speech: ExpoSpeechModule): SpeechService {
  return {
    speak: (text, opts) => Speech.speak(text, { language: toSpeechLanguage(opts.language), rate: opts.rate, onDone: opts.onDone, onError: opts.onDone }),
    stop: () => { try { Speech.stop(); } catch { /* nothing playing */ } },
    pause: () => { try { Speech.pause(); } catch { /* unsupported platform */ } },
    resume: () => { try { Speech.resume(); } catch { /* unsupported platform */ } },
    speaking: () => Speech.isSpeakingAsync().catch(() => false),
  };
}
