/**
 * Attachment media source resolution for the internal viewer.
 *
 * A chat attachment can be shown from two origins:
 *  - `blob`: a live on-device object URL (e.g. `URL.createObjectURL`) held in
 *    `previewUrl` — the media bytes live only in the browser tab.
 *  - `persisted`: raw media already uploaded to S3 and indexed (image/video/
 *    audio), identified by `mediaId` (the backend memory-node id). The viewer
 *    must fetch a short-lived presigned GET URL via the backend.
 *
 * pdf/txt are never persisted to the backend (DB kind enum only allows
 * image/video/audio), so they are always `blob` or `unavailable`.
 */

import type { AttachmentKind } from "../types";

export type AttachmentSource =
  | { type: "blob"; url: string }
  | { type: "persisted"; mediaId: string }
  | { type: "unavailable" };

const PERSISTED_KINDS: AttachmentKind[] = ["image", "video", "audio"];

export function resolveAttachmentSource(attachment: {
  id: string;
  kind: AttachmentKind;
  previewUrl?: string;
  mediaId?: string;
}): AttachmentSource {
  if (attachment.previewUrl) return { type: "blob", url: attachment.previewUrl };
  if (attachment.mediaId && PERSISTED_KINDS.includes(attachment.kind)) {
    return { type: "persisted", mediaId: attachment.mediaId };
  }
  return { type: "unavailable" };
}

/** HTML element used to render a given attachment kind in the internal viewer. */
export function attachmentViewElement(
  kind: AttachmentKind,
): "video" | "audio" | "img" | "iframe" | "pre" | null {
  switch (kind) {
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "image":
      return "img";
    case "pdf":
      return "iframe";
    case "txt":
      return "pre";
    default:
      return null;
  }
}
