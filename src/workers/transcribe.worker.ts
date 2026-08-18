/**
 * On-device speech-to-text worker — Whisper via transformers.js.
 * Receives a recorded voice-note blob, transcribes locally, posts the text back.
 *
 * Failures carry a stable `stage` so the main thread can attribute the cause
 * (model-load / inference / decode) in transcript_failed telemetry.
 */

import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

type AsrPipeline = (
  audio: string,
  options?: { language?: string; return_timestamps?: boolean },
) => Promise<{ text?: string }>;

interface TranscribeIn {
  type: "transcribe";
  blobUrl: string;
  /** ISO-639-1 language hint (e.g. "id" / "en"); undefined = auto-detect. */
  language?: string;
}

export interface TranscribeOut {
  type: "transcript";
  ok: boolean;
  text?: string;
  error?: string;
  /** model-load | inference | decode */
  stage?: string;
}

export type TranscribeStage = "model-load" | "inference" | "decode";

let transcriber: AsrPipeline | null = null;
let loading: Promise<AsrPipeline> | null = null;

async function getTranscriber(): Promise<AsrPipeline> {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny") as Promise<AsrPipeline>;
  }
  transcriber = await loading;
  return transcriber;
}

/** Preload the Whisper model off the critical path (idle warm-up). */
export async function warmupTranscriber(): Promise<void> {
  try {
    await getTranscriber();
  } catch {
    // warm-up failure is non-fatal; a real transcribe will surface it.
  }
}

/** Core logic, exported so it can be unit-tested without a Worker context. */
export async function handleTranscribe(message: TranscribeIn): Promise<TranscribeOut> {
  const base: TranscribeOut = { type: "transcript", ok: false };
  let model: AsrPipeline;
  try {
    model = await getTranscriber();
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "model load failed", stage: "model-load" };
  }

  let output: { text?: string };
  try {
    // NB: cannot build an <audio> element here — no DOM in a worker. Duration
    // is measured on the main thread in voiceNote.ts.
    output = await model(message.blobUrl, {
      language: message.language ?? "auto",
      // 0 = no timestamp decoding; single contiguous transcript is enough
      return_timestamps: false,
    });
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "inference failed", stage: "inference" };
  }

  const text = output?.text?.trim();
  if (!text) {
    return { ...base, error: "empty transcript", stage: "decode" };
  }
  return { type: "transcript", ok: true, text };
}

const ctx = globalThis as unknown as Worker;

ctx.onmessage = (event: MessageEvent<TranscribeIn>) => {
  if (event.data.type !== "transcribe") return;
  void handleTranscribe(event.data).then((payload) => ctx.postMessage(payload));
};

void warmupTranscriber();