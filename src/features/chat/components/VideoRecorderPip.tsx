import { useChatStore } from "@/features/chat/store/chatStore";
import { buildVideoTimeline, cancelVideoNote, startVideoNote, stopVideoNote } from "@/features/chat/lib/videoNote";
import { indexAttachment } from "@/features/chat/lib/attachmentIndex";
import { extFromMimeType } from "@/features/chat/lib/mediaFormats";
import { toast } from "@/shared/store/toastStore";
import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";
import { cn } from "@/shared/lib/cn";
import { LoaderCircle, Square, Video } from "lucide-react";
import { useRef, useState } from "react";

export function VideoRecorderPip() {
  const recording = useChatStore((s) => s.recording);
  const setRecording = useChatStore((s) => s.setRecording);
  const [analyzing, setAnalyzing] = useState(false);
  const cancelling = useRef(false);

  const start = async () => {
    cancelling.current = false;
    const res = await startVideoNote();
    if (!res.ok) {
      toast("Camera unavailable", res.error ?? "Permission denied.", "danger");
      return;
    }
    setRecording(true);
  };

  const stop = async () => {
    if (!recording) return;
    setRecording(false);
    if (cancelling.current) return;
    setAnalyzing(true);
    try {
      const note = await stopVideoNote();
      if (!note.ok || !note.blob || !note.blobUrl) {
        track(TELEMETRY_EVENTS.attachmentFailed, { kind: "video", stage: "record", error: note?.error ?? "no blob" });
        toast("Recording failed", note?.error ?? "No video captured.", "danger");
        return;
      }
      const durationMs = note.durationMs ?? 0;
      const { timeline, analysis } = await buildVideoTimeline(note.blobUrl, durationMs);
      if (timeline.length === 0) {
        URL.revokeObjectURL(note.blobUrl);
        toast("No faces detected", "Could not sample any frames for emotion analysis.", "danger");
        return;
      }
      const dominantConfidence =
        timeline.find((p) => p.emotion === analysis.dominantEmotion)?.confidence ?? 0;
      await indexAttachment({
        kind: "video",
        blob: note.blob,
        mimeType: note.mimeType ?? "video/webm",
        ext: extFromMimeType(note.mimeType ?? "video/webm"),
        analysis: { timeline: analysis.timeline, arc_summary: analysis.arcSummary, dominant_emotion: analysis.dominantEmotion, volatility: analysis.volatility },
        embeddedNarrative: analysis.narrative,
        title: `Video · ${analysis.dominantEmotion} · ${Math.round(durationMs / 1000)}s`,
        confidence: dominantConfidence,
        durationMs,
        frameCount: timeline.length,
      });
      URL.revokeObjectURL(note.blobUrl);
      toast("Video indexed", `${analysis.dominantEmotion} timeline → memory`, "teal");
    } catch (err) {
      track(TELEMETRY_EVENTS.attachmentFailed, {
        kind: "video",
        stage: "index",
        error: err instanceof Error ? err.message : String(err),
      });
      console.warn("[VideoRecorderPip] indexing failed:", err);
      toast("Index failed", err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <button
      type="button"
      aria-label="Record video and analyze emotion timeline"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={() => {
        cancelling.current = true;
        cancelVideoNote();
        setRecording(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        cancelling.current = true;
        cancelVideoNote();
        setRecording(false);
      }}
      disabled={analyzing}
      className={cn(
        "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-white",
        recording && "ring-2 ring-danger/60",
        analyzing && "opacity-70",
      )}
    >
      {analyzing ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : recording ? (
        <Square className="size-4 fill-danger text-danger" />
      ) : (
        <Video className="size-4" />
      )}
    </button>
  );
}
