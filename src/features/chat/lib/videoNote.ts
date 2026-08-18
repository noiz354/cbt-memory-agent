import { analyzeFrame } from "@/workers/faceClient";
import { analyzeVideoTimeline, type TimelinePoint } from "@/features/chat/lib/attachmentAnalysis";
import { timelineStops } from "@/features/chat/lib/mediaFormats";
import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";

/**
 * Video-note capture for the attachment pipeline.
 * Records camera + mic via MediaRecorder, then on stop samples frames at a
 * fixed interval and runs one-shot face analysis to build an emotion timeline.
 */

const FRAME_SAMPLE_MS = 5000;
const MAX_SAMPLES = 12;

interface VideoRecorderHandles {
  mediaRecorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
}

let recorder: VideoRecorderHandles | null = null;

export interface VideoNoteResult {
  ok: boolean;
  blob?: Blob;
  blobUrl?: string;
  durationMs?: number;
  mimeType?: string;
  error?: string;
}

export async function startVideoNote(): Promise<{ ok: true } | { ok: false; error: string }> {
  cancelVideoNote();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mediaRecorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.start();
    recorder = { mediaRecorder, stream, chunks };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Camera unavailable" };
  }
}

export function stopVideoNote(): Promise<VideoNoteResult> {
  return new Promise((resolve) => {
    const r = recorder;
    if (!r) return resolve({ ok: false, error: "not recording" });

    const stopAndBlob = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      const mimeType = r.mediaRecorder.mimeType || "video/webm";
      const blob = new Blob(r.chunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      recorder = null;
      track(TELEMETRY_EVENTS.voiceNoteRecorded);
      void measureVideoDuration(blobUrl).then((durationMs) =>
        resolve({ ok: true, blob, blobUrl, durationMs, mimeType }),
      );
    };

    if (r.mediaRecorder.state === "inactive") {
      stopAndBlob();
    } else {
      r.mediaRecorder.onstop = stopAndBlob;
      r.mediaRecorder.stop();
    }
  });
}

export function cancelVideoNote(): void {
  const r = recorder;
  if (!r) return;
  r.stream.getTracks().forEach((t) => t.stop());
  if (r.mediaRecorder.state !== "inactive") r.mediaRecorder.stop();
  recorder = null;
}

function measureVideoDuration(blobUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = blobUrl;
    video.addEventListener("loadedmetadata", () => resolve(Math.round((video.duration || 0) * 1000)), { once: true });
    video.addEventListener("error", () => resolve(0), { once: true });
    setTimeout(() => resolve(0), 5000);
  });
}

/** Sample frames from the recorded blob and build the emotion timeline. */
export async function buildVideoTimeline(
  blobUrl: string,
  durationMs: number,
): Promise<{ timeline: TimelinePoint[]; analysis: ReturnType<typeof analyzeVideoTimeline> }> {
  const video = document.createElement("video");
  video.muted = true;
  video.src = blobUrl;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Video decode failed."));
    setTimeout(() => reject(new Error("Video load timeout.")), 15000);
  });

  const step = Math.max(FRAME_SAMPLE_MS, Math.floor(durationMs / MAX_SAMPLES));
  const points: TimelinePoint[] = [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const lastMs = Math.max(0, durationMs - 1);

  for (const t of timelineStops(durationMs, step)) {
    video.currentTime = Math.min(t / 1000, Math.max(0, (durationMs - 100) / 1000));
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.onerror = () => resolve();
      setTimeout(resolve, 3000);
    });
    if (!ctx) continue;
    const w = video.videoWidth || 320;
    const h = video.videoHeight || 240;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const frame = ctx.getImageData(0, 0, w, h);
    let signal: Awaited<ReturnType<typeof analyzeFrame>>;
    try {
      signal = await analyzeFrame(frame);
    } catch {
      // One frame failed (timeout / worker error) — skip it and keep sampling;
      // never let a single failure hang or abort the whole timeline build.
      continue;
    }
    points.push({ tMs: Math.min(t, lastMs), emotion: signal.expression, confidence: signal.confidence });
  }

  return { timeline: points, analysis: analyzeVideoTimeline(points, { durationMs }) };
}
