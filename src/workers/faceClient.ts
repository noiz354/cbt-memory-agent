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
