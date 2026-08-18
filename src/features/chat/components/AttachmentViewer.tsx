import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiClient } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";
import type { ChatAttachment } from "../types";
import { attachmentViewElement, resolveAttachmentSource } from "../lib/attachmentMedia";

interface AttachmentViewerProps {
  attachment: ChatAttachment;
  onClose: () => void;
}

type ViewState =
  | { phase: "loading" }
  | { phase: "ready"; url: string }
  | { phase: "error"; message: string };

/**
 * Internal media viewer. Live attachments render straight from the blob URL;
 * persisted media (image/video/audio already uploaded to S3) fetch a short-lived
 * presigned GET URL from the backend before rendering.
 */
export function AttachmentViewer({ attachment, onClose }: AttachmentViewerProps) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [textContent, setTextContent] = useState<string | null>(null);

  const element = attachmentViewElement(attachment.kind);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    setTextContent(null);

    const source = resolveAttachmentSource(attachment);
    if (source.type === "blob") {
      setState({ phase: "ready", url: source.url });
    } else if (source.type === "unavailable") {
      setState({
        phase: "error",
        message: "Media tidak tersedia — hanya file yang di-upload tersimpan.",
      });
    } else {
      const auth = getAuthHeaders();
      if (!auth) {
        setState({ phase: "error", message: "Sesi tidak valid." });
        return;
      }
      apiClient
        .getAttachmentMedia(source.mediaId, auth.token, auth.deviceId)
        .then((res) => {
          if (cancelled) return;
          setState({ phase: "ready", url: res.url });
        })
        .catch(() => {
          if (cancelled) return;
          setState({ phase: "error", message: "Gagal memuat media dari server." });
        });
    }

    return () => {
      cancelled = true;
    };
  }, [attachment]);

  useEffect(() => {
    if (attachment.kind !== "txt" || state.phase !== "ready") return;
    let cancelled = false;
    fetch(state.url)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((text) => {
        if (!cancelled) setTextContent(text.slice(0, 20000));
      })
      .catch(() => {
        if (!cancelled) setTextContent("Tidak dapat membaca isi file teks ini.");
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.kind, state]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${attachment.name} — viewer`}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{attachment.name}</p>
            <p className="text-xs text-ink-mute">
              {attachment.kind.toUpperCase()} · {attachment.sizeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-ink-mute hover:bg-canvas hover:text-ink"
            aria-label="Close viewer"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-canvas p-4">
          {state.phase === "loading" && (
            <p className="text-sm text-ink-mute">Memuat media…</p>
          )}
          {state.phase === "error" && (
            <p className="text-sm text-danger">{state.message}</p>
          )}
          {state.phase === "ready" && element === "video" && (
            <video
              src={state.url}
              controls
              autoPlay
              className="max-h-[70vh] max-w-full rounded-lg"
            />
          )}
          {state.phase === "ready" && element === "audio" && (
            <audio src={state.url} controls autoPlay className="w-full max-w-md" />
          )}
          {state.phase === "ready" && element === "img" && (
            <img src={state.url} alt={attachment.name} className="max-h-[70vh] max-w-full rounded-lg" />
          )}
          {state.phase === "ready" && element === "iframe" && (
            <iframe
              src={state.url}
              title={attachment.name}
              className="h-[70vh] w-full rounded-lg border border-line bg-white"
            />
          )}
          {state.phase === "ready" && element === "pre" && (
            <pre className="w-full overflow-auto whitespace-pre-wrap rounded-lg bg-white p-4 text-sm text-ink">
              {textContent ?? "Memuat isi teks…"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
