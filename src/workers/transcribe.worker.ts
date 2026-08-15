/**
 * On-device speech-to-text worker — Whisper via transformers.js.
 * Receives a recorded voice-note blob, transcribes locally, posts the text back.
 */

import { pipeline, env } from "@huggingface/transformers";

interface TranscribeIn {
  type: "transcribe";
  blobUrl: string;
}

interface TranscribeOut {
  type: "transcript";
  ok: boolean;
  text?: string;
  error?: string;
  durationMs?: number;
}

env.allowLocalModels = false;

let transcriber: Awaited<ReturnType<typeof pipeline>> | null = null;
let loading: Promise<Awaited<ReturnType<typeof pipeline>>> | null = null;

async function getTranscriber(): Promise<Awaited<ReturnType<typeof pipeline>>> {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny");
  }
  transcriber = await loading;
  return transcriber;
}

self.onmessage = async (event: MessageEvent<TranscribeIn>) => {
  if (event.data.type !== "transcribe") return;
  try {
    const audio = new Audio(event.data.blobUrl);
    const durationMs = await new Promise<number>((resolve) => {
      audio.addEventListener("loadedmetadata", () => resolve(audio.duration * 1000), { once: true });
      audio.addEventListener("error", () => resolve(0), { once: true });
      setTimeout(() => resolve(0), 5000);
    });

    const model = await getTranscriber();
    const output = (await model(event.data.blobUrl)) as { text?: string };
    const text = output?.text?.trim();

    const payload: TranscribeOut = {
      type: "transcript",
      ok: Boolean(text),
      text,
      durationMs,
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
