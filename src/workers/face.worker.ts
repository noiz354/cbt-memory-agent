/**
 * On-device face-expression worker.
 * Raw pixels never leave this worker. A production build would load MediaPipe
 * Face Landmarker here; the loop below is a deterministic local stand-in so
 * the UI can bind without a network model fetch.
 */

export interface FaceWorkerIn {
  type: "frame";
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

export interface FaceWorkerOut {
  type: "signal";
  expression: "neutral" | "tense" | "sad" | "engaged" | "distressed";
  confidence: number;
  updatedAt: number;
}

const EXPRESSIONS: FaceWorkerOut["expression"][] = [
  "neutral",
  "engaged",
  "tense",
  "sad",
  "distressed",
];

self.onmessage = (event: MessageEvent<FaceWorkerIn>) => {
  if (event.data.type !== "frame") return;
  const pixels = new Uint8ClampedArray(event.data.buffer);
  let luma = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    luma += pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
  }
  const samples = Math.max(1, pixels.length / 16);
  const mean = luma / samples;
  const idx = Math.min(EXPRESSIONS.length - 1, Math.floor((mean / 255) * EXPRESSIONS.length));
  const payload: FaceWorkerOut = {
    type: "signal",
    expression: EXPRESSIONS[idx],
    confidence: 0.55 + (mean % 40) / 100,
    updatedAt: Date.now(),
  };
  self.postMessage(payload);
};
