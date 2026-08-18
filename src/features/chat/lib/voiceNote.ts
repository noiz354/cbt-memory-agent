import { startAudioWorker, stopAudioWorker } from "@/workers/audioClient";
import { useChatStore } from "@/features/chat/store/chatStore";
import { isWebSpeechSupported, startLiveRecognition, type LiveRecognition } from "./webSpeech";
import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";

/**
 * Voice-note capture on top of the audio worker pipeline.
 * Records real audio via MediaRecorder, wires the analysis worker (VAD + level)
 * while recording, then transcribes the blob on-device (Whisper).
 *
 * Fallback: when on-device transcription fails (worker/model unavailable), a
 * parallel Web Speech live transcript captured during recording is used instead.
 */

interface RecorderHandles {
  mediaRecorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  blobUrl: string | null;
}

export interface VoiceNoteResult {
  ok: boolean;
  text?: string;
  blobUrl?: string;
  durationMs?: number;
  mimeType?: string;
  /** "whisper" (on-device) | "web-speech" (fallback) */
  via?: "whisper" | "web-speech";
  error?: string;
}

const transcribeWorker =
  typeof Worker !== "undefined"
    ? new Worker(new URL("@/workers/transcribe.worker.ts", import.meta.url), { type: "module" })
    : null;

function detectLanguage(): string {
  const tag = (navigator.language || "en").toLowerCase();
  const lang = tag.split("-")[0];
  return lang === "id" || lang === "en" ? lang : "auto";
}

let recorder: RecorderHandles | null = null;
let liveRecognition: LiveRecognition | null = null;

/** Begin capturing: mic → MediaRecorder + audio-worker VAD/level. */
export async function startVoiceNote(
  onLevel?: (rms: number, peak: number) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  stopVoiceNote();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mediaRecorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.start();
    recorder = { mediaRecorder, stream, chunks, blobUrl: null };

    // Wire the analysis pipeline (VAD + RMS level) — real, gated by voice activity.
    if (onLevel) {
      void startAudioWorker(stream, (rms, peak) => {
        useChatStore.getState().setProsody(rms);
        onLevel(rms, peak);
      }).catch(() => {
        // Audio worker failure should not kill recording.
      });
    }

    // Web Speech live transcript captured in parallel — used only if on-device
    // transcription fails.
    if (isWebSpeechSupported()) {
      liveRecognition = startLiveRecognition();
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Microphone unavailable",
    };
  }
}

/** Stop capture, transcribe, and return the voice note (text + blob). */
export function stopVoiceNote(): Promise<VoiceNoteResult> {
  return new Promise((resolve) => {
    const r = recorder;
    if (!r) return resolve({ ok: false, error: "not recording" });

    stopAudioWorker();
    useChatStore.getState().setProsody(0);
    const stopAndBlob = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      const mimeType = r.mediaRecorder.mimeType || "audio/webm";
      const blob = new Blob(r.chunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      r.blobUrl = blobUrl;
      recorder = null;
      track(TELEMETRY_EVENTS.voiceNoteRecorded);
      const liveFallbackText = liveRecognition?.getTranscript();
      liveRecognition?.stop();
      liveRecognition = null;
      void transcribeVoiceNote(blobUrl, mimeType, liveFallbackText).then(resolve);
    };

    if (r.mediaRecorder.state === "inactive") {
      stopAndBlob();
    } else {
      r.mediaRecorder.onstop = stopAndBlob;
      r.mediaRecorder.stop();
    }
  });
}

function getPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  return ua.userAgentData?.platform ?? navigator.platform ?? "unknown";
}

function trackTranscriptFailure(via: "whisper" | "web-speech", stage: string, error?: string): void {
  track(TELEMETRY_EVENTS.transcriptFailed, {
    via,
    stage,
    error: error ?? "no transcript",
    platform: getPlatform(),
  });
}

/** Cancel recording without producing a note. */
export function cancelVoiceNote(): void {
  const r = recorder;
  liveRecognition?.stop();
  liveRecognition = null;
  if (!r) return;
  stopAudioWorker();
  useChatStore.getState().setProsody(0);
  r.stream.getTracks().forEach((t) => t.stop());
  if (r.mediaRecorder.state !== "inactive") r.mediaRecorder.stop();
  if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
  recorder = null;
}

type TranscribeMsg = {
  type: "transcript";
  ok: boolean;
  text?: string;
  error?: string;
};

/** Measure a blob's duration on the main thread (DOM only). */
function measureBlobDuration(blobUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio(blobUrl);
    audio.addEventListener("loadedmetadata", () => resolve(audio.duration * 1000), { once: true });
    audio.addEventListener("error", () => resolve(0), { once: true });
    setTimeout(() => resolve(0), 5000);
  });
}

async function transcribeVoiceNote(
  blobUrl: string,
  mimeType: string,
  liveFallbackText?: string,
): Promise<VoiceNoteResult> {
  if (!transcribeWorker) {
    trackTranscriptFailure("whisper", "worker-init", "worker unavailable");
    return new Promise<VoiceNoteResult>((resolve) => resolveFromFallback(resolve, liveFallbackText, blobUrl));
  }
  const durationMs = await measureBlobDuration(blobUrl);
  return new Promise((resolve) => {
    const onMsg = (event: MessageEvent<TranscribeMsg>) => {
      transcribeWorker?.removeEventListener("message", onMsg);
      if (event.data.type !== "transcript") return;
      if (event.data.ok && event.data.text) {
        track(TELEMETRY_EVENTS.transcriptReceived, { via: "whisper" });
        resolve({
          ok: true,
          text: event.data.text,
          blobUrl,
          durationMs,
          mimeType,
          via: "whisper",
        });
      } else {
        trackTranscriptFailure("whisper", "worker", event.data.error ?? (event.data.text ? "empty text" : "no transcript"));
        resolveFromFallback(resolve, liveFallbackText, blobUrl, event.data.error);
      }
    };
    transcribeWorker.addEventListener("message", onMsg);
    transcribeWorker.postMessage({ type: "transcribe", blobUrl, language: detectLanguage() });
  });
}

function resolveFromFallback(
  resolve: (v: VoiceNoteResult) => void,
  text: string | undefined,
  blobUrl: string,
  error?: string,
): void {
  if (text) {
    track(TELEMETRY_EVENTS.transcriptReceived, { via: "web-speech" });
    resolve({ ok: true, text, blobUrl, via: "web-speech" });
  } else {
    trackTranscriptFailure("web-speech", "fallback", error ?? "no web-speech transcript");
    resolve({ ok: false, blobUrl, error: error ?? "transcription failed" });
  }
}
