import type { FaceSignal } from "@/features/chat/types";
import type { FaceWorkerOut } from "./face.worker";

export type FaceMode = "active" | "idle" | "crisis";

const INTERVALS_MS: Record<FaceMode, number> = {
  active: 200, // 5 Hz — camera on, user engaged
  idle: 1000, // 1 Hz — camera on but quiet
  crisis: 0, // 0 Hz — crisis protocol engaged, stop capturing
};

const CRISIS_POLL_MS = 500;

let worker: Worker | null = null;
let timer: number | null = null;

export function startFaceWorker(
  video: HTMLVideoElement | null,
  onSignal: (signal: FaceSignal) => void,
  getMode: () => FaceMode,
) {
  stopFaceWorker();
  worker = new Worker(new URL("./face.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<FaceWorkerOut>) => {
    if (event.data.type !== "signal") return;
    onSignal({
      expression: event.data.expression,
      confidence: event.data.confidence,
      updatedAt: event.data.updatedAt,
      model: event.data.model,
    });
  };

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // Self-scheduling setTimeout (not setInterval) so a mode change from the
  // stores (recording / streaming / crisisActive) takes effect on the next tick
  // without restarting the worker.
  const tick = () => {
    if (!worker) return;
    const mode = getMode();
    const delay = mode === "crisis" ? CRISIS_POLL_MS : INTERVALS_MS[mode];

    // Video not ready (or no 2D context) yet — reschedule and retry so the
    // loop keeps running once the stream starts.
    if (!video || !ctx || video.readyState < 2) {
      timer = window.setTimeout(tick, delay);
      return;
    }

    // Crisis: 0 Hz — do not capture. Keep a slow poll so we can resume the
    // moment the overlay is dismissed.
    if (mode === "crisis") {
      timer = window.setTimeout(tick, CRISIS_POLL_MS);
      return;
    }

    canvas.width = 64;
    canvas.height = 48;
    ctx.drawImage(video, 0, 0, 64, 48);
    const image = ctx.getImageData(0, 0, 64, 48);
    worker.postMessage(
      { type: "frame", width: 64, height: 48, buffer: image.data.buffer },
      [image.data.buffer],
    );

    timer = window.setTimeout(tick, INTERVALS_MS[mode]);
  };

  timer = window.setTimeout(tick, INTERVALS_MS.active);
}

export function stopFaceWorker() {
  if (timer) window.clearTimeout(timer);
  timer = null;
  worker?.terminate();
  worker = null;
}

// Dedicated one-shot analysis worker for media attachments (snapshots, video
// timeline). Kept warm (model stays loaded) so successive frames classify
// against real MediaPipe instead of the luma fallback.
let analyzerWorker: Worker | null = null;
const analyzerQueue: {
  resolve: (signal: FaceSignal) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}[] = [];

// A frame must classify within this window or it is treated as a failure so the
// video-timeline loop can move on instead of hanging (model init can be slow on
// first frame; still bounds the worst-case latency).
const ANALYZE_TIMEOUT_MS = 12_000;

/**
 * Run face-expression classification on a single frame (one-shot).
 * Used by the image-snapshot and video-timeline attachment pipelines.
 * Returns a promise that resolves with the FaceSignal for that frame, or
 * rejects after ANALYZE_TIMEOUT_MS / on worker error (no permanent hang).
 */
export function analyzeFrame(frame: ImageData): Promise<FaceSignal> {
  if (!analyzerWorker) {
    analyzerWorker = new Worker(new URL("./face.worker.ts", import.meta.url), { type: "module" });
    analyzerWorker.onmessage = (event: MessageEvent<FaceWorkerOut>) => {
      if (event.data.type !== "signal") return;
      const pending = analyzerQueue.shift();
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve({
          expression: event.data.expression,
          confidence: event.data.confidence,
          updatedAt: event.data.updatedAt,
          model: event.data.model,
        });
      }
    };
    analyzerWorker.onerror = (event) => rejectAll(new Error(event?.message || "Face analyzer error"));
  }

  return new Promise<FaceSignal>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = analyzerQueue.findIndex((p) => p.timer === timer);
      if (idx >= 0) analyzerQueue.splice(idx, 1);
      reject(new Error("Face analyze timed out"));
    }, ANALYZE_TIMEOUT_MS);
    analyzerQueue.push({ resolve, reject, timer });
    const buffer = frame.data.buffer.slice(0); // copy — caller may reuse the canvas
    analyzerWorker?.postMessage(
      { type: "analyze", width: frame.width, height: frame.height, buffer },
      [buffer],
    );
  });
}

function rejectAll(err: Error): void {
  for (const pending of analyzerQueue.splice(0)) {
    clearTimeout(pending.timer);
    pending.reject(err);
  }
}

/** Terminate the one-shot analyzer (releases the MediaPipe model). */
export function stopAnalyzeWorker() {
  analyzerWorker?.terminate();
  analyzerWorker = null;
  rejectAll(new Error("Face analyzer terminated."));
}
