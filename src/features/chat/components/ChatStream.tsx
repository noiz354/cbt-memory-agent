import { useChatStore } from "@/features/chat/store/chatStore";
import { DROP_ZONES } from "@/shared/lib/dnd";
import { cn } from "@/shared/lib/cn";
import { useDroppable } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Brain, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatBubble } from "./ChatBubble";

export function ChatStream() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeDropZone = useChatStore((s) => s.activeDropZone);
  const hydrating = useChatStore((s) => s.hydrating);
  const hydrateError = useChatStore((s) => s.hydrateError);
  const parentRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const { setNodeRef, isOver } = useDroppable({
    id: DROP_ZONES.CHAT_STREAM,
    data: { accepts: ["memory-card", "snapshot", "file"] },
  });

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 128,
    overscan: 10,
    paddingStart: 12,
    paddingEnd: 20,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  const tailContent = messages.at(-1)?.content;

  useEffect(() => {
    virtualizer.measure();
  }, [tailContent, messages.length, virtualizer]);

  useEffect(() => {
    if (!stickToBottom || messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" });
  }, [messages.length, tailContent, isStreaming, stickToBottom, virtualizer]);

  const onScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distance < 96);
  };

  const glowing = isOver || activeDropZone === DROP_ZONES.CHAT_STREAM;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.4rem] bg-white/70 ring-1 ring-line transition-[box-shadow,background-color] duration-200",
        glowing && "drop-glow bg-teal-mist/40",
      )}
    >
      {glowing && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-teal/95 py-2 text-xs font-semibold uppercase tracking-wider text-white">
          <Brain className="size-3.5" />
          Drop to inject core memory into this turn
        </div>
      )}

      <div
        ref={parentRef}
        onScroll={onScroll}
        className="scrollbar-thin h-full overflow-y-auto px-3 py-2 @md:px-5"
      >
        {messages.length === 0 && !hydrating && (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
            {hydrateError ? (
              <>
                <p className="text-sm font-semibold text-amber-700">
                  Could not load this conversation
                </p>
                <p className="text-xs text-ink-mute">{hydrateError}</p>
                <p className="text-xs text-ink-mute">
                  This session lives in your private on-device vault — it stays here unless you
                  start a new one.
                </p>
              </>
            ) : (
              <>
                <Brain className="size-6 text-ink-mute/60" />
                <p className="text-sm font-semibold text-ink">A fresh, private session</p>
                <p className="max-w-xs text-xs leading-relaxed text-ink-mute">
                  Everything you type is analyzed on-device and synced to your vault as a
                  conversation. Drag a core memory in to ground this turn.
                </p>
              </>
            )}
          </div>
        )}
        {hydrating && (
          <div className="flex h-full min-h-40 items-center justify-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-mute">
            <span className="inline-block size-3 animate-spin rounded-full border-2 border-ink/20 border-t-teal" />
            Restoring conversation…
          </div>
        )}
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const message = messages[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full pb-3"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {message && <ChatBubble message={message} />}
              </div>
            );
          })}
        </div>
      </div>
      {!stickToBottom && (
        <button
          type="button"
          onClick={() => {
            setStickToBottom(true);
            virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" });
          }}
          className="absolute bottom-3 right-3 z-10 inline-flex size-10 items-center justify-center rounded-full bg-ink text-white shadow-[var(--shadow-float)]"
          aria-label="Scroll to latest turn"
        >
          <ChevronDown className="size-4" />
        </button>
      )}
    </div>
  );
}
