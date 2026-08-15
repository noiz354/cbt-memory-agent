import { startAudioWorker, stopAudioWorker } from "@/workers/audioClient";

/**
 * Voice-note capture on top of the audio worker pipeline.
 * Records real audio via MediaRecorder, wires the analysis worker (VAD + level)
 * while recording, then transcribes the blob on-device.
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
  error?: string;
}

const transcribeWorker =
  typeof Worker !== "undefined"
    ? new Worker(new URL("@/workers/transcribe.worker", import.meta.url), { type: "module" })
    : null;

let recorder: RecorderHandles | null = null;
let onLevelCb: ((rms: number) => void) | null = null;

export function getRecorderLevel(): number {
  return recorder ? recorder.chunks.length * 2 : 0;
}

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
    onLevelCb = onLevel ?? null;

    // Wire the analysis pipeline (VAD + RMS level) — real, gated by voice activity.
    if (onLevel) {
      void startAudioWorker(stream, onLevel).catch(() => {
        // Audio worker failure should not kill recording.
      });
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
    const stopAndBlob = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(r.chunks, { type: r.mediaRecorder.mimeType || "audio/webm" });
      const blobUrl = URL.createObjectURL(blob);
      r.blobUrl = blobUrl;
      recorder = null;
      onLevelCb = null;
      void transcribeVoiceNote(blobUrl, blob).then(resolve);
    };

    if (r.mediaRecorder.state === "inactive") {
      stopAndBlob();
    } else {
      r.mediaRecorder.onstop = stopAndBlob;
      r.mediaRecorder.stop();
    }
  });
}

/** Cancel recording without producing a note. */
export function cancelVoiceNote(): void {
  const r = recorder;
  if (!r) return;
  stopAudioWorker();
  r.stream.getTracks().forEach((t) => t.stop());
  if (r.mediaRecorder.state !== "inactive") r.mediaRecorder.stop();
  if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
  recorder = null;
  onLevelCb = null;
}

function transcribeVoiceNote(blobUrl: string, blob: Blob): Promise<VoiceNoteResult> {
  return new Promise((resolve) => {
    if (!transcribeWorker) {
      return resolve({ ok: false, blobUrl, error: "transcription unavailable" });
    }
    const onMsg = (event: MessageEvent<{ type: "transcript"; ok: boolean; text?: string; durationMs?: number; error?: string }>) => {
      transcribeWorker?.removeEventListener("message", onMsg);
      if (event.data.type !== "transcript") return;
      if (event.data.ok && event.data.text) {
        resolve({ ok: true, text: event.data.text, blobUrl, durationMs: event.data.durationMs });
      } else {
        resolve({ ok: false, blobUrl, error: event.data.error ?? "transcription failed" });
      }
    };
    transcribeWorker.addEventListener("message", onMsg);
    transcribeWorker.postMessage({ type: "transcribe", blobUrl });
  });
}
