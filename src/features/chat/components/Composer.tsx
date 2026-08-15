import { useChatStore } from "@/features/chat/store/chatStore";
import { DROP_ZONES } from "@/shared/lib/dnd";
import { cn } from "@/shared/lib/cn";
import { useAppStore } from "@/shared/store/appStore";
import { useDroppable } from "@dnd-kit/core";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { useEffect } from "react";
import { AutoExpandTextarea } from "./AutoExpandTextarea";
import { HoldToTalkOrb } from "./HoldToTalkOrb";

const DRAFT_KEY = "cbt-composer-draft";

export function Composer() {
  const composer = useChatStore((s) => s.composer);
  const setComposer = useChatStore((s) => s.setComposer);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const quote = useChatStore((s) => s.quote);
  const setQuote = useChatStore((s) => s.setQuote);
  const pendingAttachments = useChatStore((s) => s.pendingAttachments);
  const pendingMemories = useChatStore((s) => s.pendingMemories);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const removePendingMemory = useChatStore((s) => s.removePendingMemory);
  const attachFiles = useChatStore((s) => s.attachFiles);
  const crisisActive = useAppStore((s) => s.crisisActive);

  const { setNodeRef, isOver } = useDroppable({
    id: DROP_ZONES.COMPOSER,
    data: { accepts: ["chat-bubble", "memory-card", "snapshot"] },
  });

  const canSend = Boolean(composer.trim() || pendingAttachments.length) && !crisisActive;

  useEffect(() => {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (saved && !useChatStore.getState().composer) setComposer(saved);
  }, [setComposer]);

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, composer);
  }, [composer]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-[1.4rem] bg-white p-2.5 shadow-[var(--shadow-glass)] ring-1 ring-line transition-shadow",
        isOver && "drop-glow",
      )}
    >
      {quote && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-xl bg-canvas px-3 py-2">
          <p className="text-xs leading-5 text-ink-mute">
            <span className="font-semibold text-teal">Quote & reply · </span>
            {quote.excerpt}
          </p>
          <button type="button" aria-label="Clear quote" onClick={() => setQuote(null)}>
            <X className="size-3.5 text-ink-mute" />
          </button>
        </div>
      )}

      {(pendingMemories.length > 0 || pendingAttachments.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingMemories.map((mem) => (
            <span
              key={mem.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-mist px-2.5 py-1 text-xs font-medium text-teal"
            >
              {mem.title}
              <button type="button" onClick={() => removePendingMemory(mem.id)} aria-label="Remove memory">
                <X className="size-3" />
              </button>
            </span>
          ))}
          {pendingAttachments.map((file) => (
            <span
              key={file.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-ink-soft"
            >
              {file.previewUrl && (
                <img src={file.previewUrl} alt="" className="size-4 rounded object-cover" />
              )}
              {file.name}
              <button type="button" onClick={() => removeAttachment(file.id)} aria-label="Remove file">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <label className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-mute hover:bg-canvas hover:text-ink">
          <Paperclip className="size-4" />
          <input
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            aria-label="Attach files"
            className="sr-only"
            multiple
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].map((file) => ({
                id: `${file.name}_${file.size}`,
                kind: (file.name.endsWith(".pdf") ? "pdf" : "txt") as "pdf" | "txt",
                name: file.name,
                sizeLabel: `${Math.max(1, Math.round(file.size / 1024))} KB`,
              }));
              if (files.length) attachFiles(files);
              e.target.value = "";
            }}
          />
        </label>

        <div className="min-w-0 flex-1 py-2.5 pr-1">
          <AutoExpandTextarea
            value={composer}
            onValueChange={setComposer}
            onSubmit={() => {
              sessionStorage.removeItem(DRAFT_KEY);
              sendMessage();
            }}
            placeholder={
              crisisActive
                ? "Session hard-halted. Crisis protocol is on screen."
                : "Write a turn… Enter to send, Shift+Enter for a new line"
            }
            aria-label="Session message"
            disabled={crisisActive}
          />
        </div>

        <HoldToTalkOrb />

        <button
          type="button"
          disabled={!canSend || isStreaming}
          onClick={() => sendMessage()}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-teal text-white shadow-[0_8px_18px_rgba(13,148,136,0.3)] transition-opacity disabled:opacity-40"
          aria-label="Send message"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}
