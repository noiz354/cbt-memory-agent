import { analyzeAudio, type AudioAnalysis } from "@/features/chat/lib/attachmentAnalysis";
import { indexAttachment, type IndexAttachmentResult } from "@/features/chat/lib/attachmentIndex";

interface ProsodyMsg {
  type: "prosody";
  ok: boolean;
  result?: {
    avgPitch: number;
    pitchVariance: number;
    speechRateWpm: number;
    pauseRatio: number;
    energy: number;
  };
  durationMs?: number;
  error?: string;
}

let prosodyWorker: Worker | null = null;

function getProsodyWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!prosodyWorker) {
    prosodyWorker = new Worker(new URL("@/workers/prosody.worker.ts", import.meta.url), { type: "module" });
  }
  return prosodyWorker;
}

/** Compute prosody features on-device from a recorded voice-note blob. */
export async function analyzeVoiceProsody(
  blobUrl: string,
  wordCount: number,
): Promise<ProsodyMsg["result"]> {
  const worker = getProsodyWorker();
  if (!worker) throw new Error("Prosody worker unavailable.");

  return new Promise((resolve, reject) => {
    const onMsg = (event: MessageEvent<ProsodyMsg>) => {
      worker.removeEventListener("message", onMsg);
      if (event.data.type !== "prosody") return;
      if (event.data.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "Prosody analysis failed."));
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage({ type: "analyze", blobUrl, wordCount });
  });
}

/**
 * Full voice-note attachment pipeline: prosody → fused emotion → narrative →
 * presign/upload/create. Returns the created memory node id.
 */
export async function indexVoiceNote(input: {
  blobUrl: string;
  mimeType: string;
  transcript: string;
  durationMs: number;
}): Promise<IndexAttachmentResult> {
  const wordCount = input.transcript.trim().split(/\s+/).filter(Boolean).length;
  const prosody = await analyzeVoiceProsody(input.blobUrl, wordCount);
  if (!prosody) throw new Error("Prosody analysis returned no features.");
  const analysis: AudioAnalysis = analyzeAudio({
    transcript: input.transcript,
    durationMs: input.durationMs,
    prosody,
  });

  const { fusedEmotion } = analysis;
  const title = `Voice note · ${fusedEmotion.emotion} · ${Math.round(input.durationMs / 1000)}s`;
  const blob = await fetch(input.blobUrl).then((r) => r.blob());

  return indexAttachment({
    kind: "audio",
    blob,
    mimeType: input.mimeType,
    ext: "webm",
    analysis: {
      transcript: input.transcript,
      prosody,
      text_emotion: analysis.textEmotion,
      fused_emotion: analysis.fusedEmotion,
    },
    embeddedNarrative: analysis.narrative,
    title,
    confidence: fusedEmotion.confidence,
    durationMs: input.durationMs,
  });
}
