import { attachmentKindLabel, formatAttachmentTime } from "@/features/memory/lib/attachmentFormat";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { apiClient, type AttachmentListItem } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { toast } from "@/shared/store/toastStore";
import { Badge } from "@/shared/ui/Badge";
import { AudioLines, Image, RefreshCw, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function KindIcon({ kind }: { kind: AttachmentListItem["kind"] }) {
  if (kind === "image") return <Image className="size-4" />;
  if (kind === "video") return <Video className="size-4" />;
  return <AudioLines className="size-4" />;
}

/**
 * AttachmentGallery — list the raw-media attachments this user indexed
 * (GET /attachments) and delete them (DELETE /attachments/:id). Deleting a
 * media attachment removes the raw S3 object and cascades the memory node.
 */
export function AttachmentGallery() {
  const [items, setItems] = useState<AttachmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const hydrate = useMemoryStore((s) => s.hydrate);

  const load = useCallback(async () => {
    const auth = getAuthHeaders();
    if (!auth) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.listAttachments(auth.token, auth.deviceId);
      setItems(Array.isArray(res.attachments) ? res.attachments : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load media");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (item: AttachmentListItem) => {
    const auth = getAuthHeaders();
    if (!auth) return;
    setDeletingId(item.id);
    try {
      await apiClient.deleteAttachment(item.id, auth.token, auth.deviceId);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast("Media deleted", "Raw S3 object and memory node removed.", "success");
      // The cascade removed a memory node — refresh the graph so the card disappears.
      void hydrate();
    } catch (err) {
      toast(
        "Delete failed",
        err instanceof Error ? err.message : "Could not delete media",
        "danger",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 py-2 md:px-5">
        <h2 className="text-sm font-bold">Media</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-ink-mute transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <RefreshCw className="size-3" />
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-ink-mute md:px-5">Loading media…</p>
      ) : error ? (
        <div className="mx-4 mt-2 rounded-xl bg-danger-mist px-4 py-3 text-sm text-ink md:mx-5">{error}</div>
      ) : items.length === 0 ? (
        <div className="mx-4 mt-2 rounded-2xl border border-dashed border-line bg-white/50 px-4 py-8 text-center md:mx-5">
          <p className="font-display text-sm font-bold">No media yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-ink-mute">
            Photos, voice notes, and videos you analyze in the Workspace are stored here as
            attachments — raw media in S3, index in your vault.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 md:px-5">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-2xl border border-line bg-white p-3.5"
            >
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-teal-mist text-teal">
                <KindIcon kind={item.kind} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-display text-sm font-bold">{item.title}</p>
                  <Badge tone="teal">{attachmentKindLabel(item.kind)}</Badge>
                  <span className="text-[11px] text-ink-mute">
                    {formatAttachmentTime(item.createdAt)}
                  </span>
                </div>
                {item.excerpt ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-4 text-ink-mute">{item.excerpt}</p>
                ) : item.embeddedNarrative ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-4 text-ink-mute">
                    {item.embeddedNarrative}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`Delete ${item.title}`}
                disabled={deletingId === item.id}
                onClick={() => void handleDelete(item)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink-mute transition-colors hover:bg-danger-mist hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="size-3" />
                {deletingId === item.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
