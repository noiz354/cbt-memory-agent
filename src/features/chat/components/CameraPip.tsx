import { useChatStore } from "@/features/chat/store/chatStore";
import { startFaceWorker, stopFaceWorker } from "@/workers/faceClient";
import { cn } from "@/shared/lib/cn";
import { useAppStore } from "@/shared/store/appStore";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Camera, CameraOff, ScanFace } from "lucide-react";
import { useEffect, useRef } from "react";

export function CameraPip() {
  const cameraOpen = useChatStore((s) => s.cameraOpen);
  const setCameraOpen = useChatStore((s) => s.setCameraOpen);
  const face = useChatStore((s) => s.face);
  const setFace = useChatStore((s) => s.setFace);
  const attachSnapshot = useChatStore((s) => s.attachSnapshot);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: "camera-pip",
    data: { type: "snapshot" },
    disabled: !cameraOpen,
  });

  useEffect(() => {
    if (!cameraOpen) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      stopFaceWorker();
      setFace({ expression: "neutral", confidence: 0.42, updatedAt: Date.now(), model: "fallback" });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 320, height: 240 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        // distressHint is owned by CrisisFusionBridge (single writer); this
        // component only publishes the raw face signal into the store.
        startFaceWorker(
          videoRef.current,
          (signal) => setFace(signal),
          () => {
            const { recording, isStreaming } = useChatStore.getState();
            if (useAppStore.getState().crisisActive) return "crisis";
            if (recording || isStreaming) return "active";
            return "idle";
          },
        );
      } catch {
        setCameraOpen(false);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopFaceWorker();
    };
  }, [cameraOpen, setCameraOpen, setFace]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    attachSnapshot(canvas.toDataURL("image/jpeg", 0.8));
  };

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "absolute right-3 top-3 z-30 w-[196px] rounded-2xl bg-ink p-2 text-white shadow-[var(--shadow-float)]",
        isDragging && "opacity-70",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-teal-soft">
          <ScanFace className="size-3" />
          On-device vision
        </span>
        <button
          type="button"
          className="rounded-lg p-1 hover:bg-white/10"
          aria-label={cameraOpen ? "Close camera" : "Open camera"}
          onClick={() => setCameraOpen(!cameraOpen)}
        >
          {cameraOpen ? <Camera className="size-3.5" /> : <CameraOff className="size-3.5" />}
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-xl bg-ink-soft"
        {...listeners}
        {...attributes}
      >
        {cameraOpen ? (
          <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
        ) : (
          <div className="flex aspect-video items-center justify-center text-[11px] text-white/50">
            Camera idle
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between px-1 text-[11px]">
        <span className="capitalize text-white/80">{face.expression}</span>
        <span className="text-white/60">
          {Math.round(face.confidence * 100)}% · {face.model === "mediapipe" ? "ML" : "approx"}
        </span>
      </div>

      {cameraOpen && (
        <button
          type="button"
          onClick={capture}
          className="mt-2 w-full rounded-xl bg-white/10 py-1.5 text-[11px] font-semibold uppercase tracking-wide hover:bg-white/16"
        >
          Snapshot → composer
        </button>
      )}
    </div>
  );
}
