/**
 * On-device speech-to-text worker — Whisper via transformers.js.
 * Receives a recorded voice-note blob, transcribes locally, posts the text back.
 */

import { pipeline, env } from "@huggingface/transformers";

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

interface TranscribeOut {
  type: "transcript";
  ok: boolean;
  text?: string;
  error?: string;
}

env.allowLocalModels = false;

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

self.onmessage = async (event: MessageEvent<TranscribeIn>) => {
  if (event.data.type !== "transcribe") return;
  try {
    const model = await getTranscriber();
    // NB: cannot build an <audio> element here — no DOM in a worker. Duration
    // is measured on the main thread in voiceNote.ts.
    const output = await model(event.data.blobUrl, {
      language: event.data.language ?? "auto",
      // 0 = no timestamp decoding; single contiguous transcript is enough
      return_timestamps: false,
    });
    const text = output?.text?.trim();

    const payload: TranscribeOut = {
      type: "transcript",
      ok: Boolean(text),
      text,
    };
    self.postMessage(payload);
  } catch (err) {
    self.postMessage({
      type: "transcript",
      ok: false,
      error: err instanceof Error ? err.message : "transcription failed",
    } satisfies TranscribeOut);
  }
};
