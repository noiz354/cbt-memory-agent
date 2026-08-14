import type { FaceSignal } from "@/features/chat/types";
import type { FaceWorkerOut } from "./face.worker";

let worker: Worker | null = null;
let timer: number | null = null;

export function startFaceWorker(
  video: HTMLVideoElement | null,
  onSignal: (signal: FaceSignal) => void,
) {
  stopFaceWorker();
  worker = new Worker(new URL("./face.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<FaceWorkerOut>) => {
    if (event.data.type !== "signal") return;
    onSignal({
      expression: event.data.expression,
      confidence: event.data.confidence,
      updatedAt: event.data.updatedAt,
    });
  };

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const tick = () => {
    if (!worker || !video || !ctx || video.readyState < 2) return;
    canvas.width = 64;
    canvas.height = 48;
    ctx.drawImage(video, 0, 0, 64, 48);
    const image = ctx.getImageData(0, 0, 64, 48);
    worker.postMessage(
      { type: "frame", width: 64, height: 48, buffer: image.data.buffer },
      [image.data.buffer],
    );
  };

  timer = window.setInterval(tick, 280);
}

export function stopFaceWorker() {
  if (timer) window.clearInterval(timer);
  timer = null;
  worker?.terminate();
  worker = null;
}
