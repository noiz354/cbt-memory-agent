/**
 * Web Speech API live-transcription helper.
 *
 * Whisper (on-device) tetap primary; helper ini berjalan paralel saat recording
 * dan hasilnya dipakai hanya bila transkripsi on-device gagal. Web Speech tidak
 * bisa mentranskripsi blob audio, jadi ia mendengarkan mic live selama recording.
 */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getCtor() !== null;
}

export interface LiveRecognition {
  stop: () => void;
  getTranscript: () => string;
}

/**
 * Start listening to the live mic. Accumulates final (and interim, as a last
 * resort) transcripts. Caller must stop() to read the result.
 */
export function startLiveRecognition(onStatus?: (running: boolean) => void): LiveRecognition | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  const lang = (navigator.language || "en").toLowerCase().split("-")[0];
  rec.lang = lang === "id" || lang === "en" ? lang : "en-US";

  let finalText = "";
  let interimText = "";

  rec.onresult = (event) => {
    finalText = "";
    interimText = "";
    for (let i = event.results.length - 1; i >= 0; i--) {
      const res = event.results[i];
      if (res.isFinal) {
        finalText = (finalText + " " + res[0].transcript).trim();
      } else {
        interimText += res[0].transcript + " ";
      }
    }
  };
  rec.onerror = () => {
    rec.abort();
    onStatus?.(false);
  };
  rec.onend = () => onStatus?.(false);

  try {
    rec.start();
    onStatus?.(true);
  } catch {
    return null;
  }

  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
      onStatus?.(false);
    },
    getTranscript: () => finalText.trim() || interimText.trim(),
  };
}
