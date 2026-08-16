import type { AttachmentKind } from "@/shared/lib/apiClient";

export function attachmentKindLabel(kind: AttachmentKind): string {
  switch (kind) {
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "audio":
      return "Voice note";
  }
}

export function formatAttachmentTime(createdAt?: string): string {
  if (!createdAt) return "—";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "—";
  const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day} · ${time}`;
}
