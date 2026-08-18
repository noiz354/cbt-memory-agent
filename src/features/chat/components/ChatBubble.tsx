import { ChatMarkdown } from "@/features/chat/lib/markdown";
import type { ChatAttachment, ChatMessage } from "@/features/chat/types";
import { useChatStore } from "@/features/chat/store/chatStore";
import { cn } from "@/shared/lib/cn";
import { formatClock } from "@/shared/lib/format";
import { isSpeaking, toggleSpeak } from "@/shared/lib/speech";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { FileText, GripVertical, ImageIcon, Mic, Quote, Sparkles, Video, Volume2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { WaveformScrubber } from "./WaveformScrubber";
import { AttachmentViewer } from "./AttachmentViewer";
import { formatModelLabel } from "@/features/chat/lib/modelSelection";

const DISTORTIONS = [
  "catastrophizing",
  "threat-scan",
  "automatic thought",
  "all-or-nothing",
  "mind reading",
];

interface ChatBubbleProps {
  message: ChatMessage;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const triggerBargeIn = useChatStore((s) => s.triggerBargeIn);
  const setQuote = useChatStore((s) => s.setQuote);
  const [viewing, setViewing] = useState<ChatAttachment | null>(null);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `bubble:${message.id}`,
    data: { type: "chat-bubble", message },
    disabled: isUser || isSystem,
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform), zIndex: 30 }
    : undefined;

  return (
    <motion.article
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: isDragging ? 0.45 : 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "relative max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 shadow-sm",
          isUser
            ? "bg-ink text-white rounded-br-md"
            : isSystem
              ? "bg-danger-mist text-ink ring-1 ring-danger/30 rounded-bl-md"
              : "bg-white text-ink ring-1 ring-line rounded-bl-md",
        )}
      >
        {!isUser && !isSystem && (
          <button
            type="button"
            className="absolute -left-2 top-3 hidden size-7 items-center justify-center rounded-full bg-white text-ink-mute shadow-sm ring-1 ring-line @md:flex"
            aria-label="Drag to quote this reply"
            {...listeners}
            {...attributes}
          >
            <GripVertical className="size-3.5" />
          </button>
        )}

        {message.injectedMemories && message.injectedMemories.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.injectedMemories.map((mem) => (
              <Link
                key={mem.id}
                to="/memory"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                  isUser ? "bg-white/12 text-teal-mist" : "bg-teal-mist text-teal",
                )}
              >
                <Sparkles className="size-3" />
                Recall {Math.round(mem.weight * 100)}% · {mem.title}
              </Link>
            ))}
          </div>
        )}

        {!isUser && !isSystem && message.recalledTitles && message.recalledTitles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.recalledTitles.map((title, idx) => (
              <Link
                key={`${title}-${idx}`}
                to="/memory"
                className="inline-flex items-center gap-1 rounded-full bg-teal-mist px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-teal"
              >
                <Sparkles className="size-3" />
                Recalled · {title}
              </Link>
            ))}
          </div>
        )}

        {!isUser && !isSystem && message.recalledMemoryIds && message.recalledMemoryIds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
              <Sparkles className="size-3" />
              Recalled {message.recalledMemoryIds.length} memory
              {message.recalledMemoryIds.length > 1 ? "ies" : ""} from your vault
            </span>
          </div>
        )}

        {!isUser && !isSystem && DISTORTIONS.some((d) => message.content.toLowerCase().includes(d)) && (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            CBT pattern marked — {DISTORTIONS.find((d) => message.content.toLowerCase().includes(d))}
          </p>
        )}

        {message.quotedFromId && (
          <div
            className={cn(
              "mb-2 flex items-start gap-2 rounded-xl px-3 py-2 text-xs",
              isUser ? "bg-white/10 text-white/80" : "bg-canvas text-ink-mute",
            )}
          >
            <Quote className="mt-0.5 size-3.5 shrink-0" />
            <span>Quoted prior turn · {message.quotedFromId.slice(-6)}</span>
          </div>
        )}

        {message.attachments?.map((file) => (
          <button
            type="button"
            key={file.id}
            onClick={() => setViewing(file)}
            className={cn(
              "mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
              isUser ? "bg-white/10 hover:bg-white/15" : "bg-canvas hover:bg-ink/5",
            )}
          >
            {file.kind === "image" && file.previewUrl ? (
              <img
                src={file.previewUrl}
                alt={file.name}
                className="h-16 w-16 rounded-lg object-cover"
              />
            ) : file.kind === "image" ? (
              <ImageIcon className="size-4" />
            ) : file.kind === "video" ? (
              <Video className="size-4 text-teal" />
            ) : file.kind === "audio" ? (
              <Mic className="size-4 text-teal" />
            ) : (
              <FileText className="size-4 text-teal" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{file.name}</p>
              <p className={cn("text-xs", isUser ? "text-white/60" : "text-ink-mute")}>
                {file.kind.toUpperCase()} · {file.sizeLabel} · tap to open
              </p>
            </div>
          </button>
        ))}

        {isUser ? (
          <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
        ) : (
          <ChatMarkdown content={message.content || (message.streaming ? "▍" : "")} />
        )}

        {message.streaming && (
          <span className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-teal" />
        )}
        {message.truncated && (
          <button
            type="button"
            onClick={() => useChatStore.getState().resumeStream()}
            className="mt-2 text-xs font-semibold text-teal"
          >
            Auto-resume truncated stream
          </button>
        )}

        {message.audio && !isUser && (
          <div
            className="mt-3"
            onPointerUp={(event) => {
              const el = event.currentTarget;
              const x = event.clientX - el.getBoundingClientRect().left;
              if (x < 28) triggerBargeIn();
            }}
          >
            <WaveformScrubber
              peaks={message.audio.peaks}
              durationMs={message.audio.durationMs}
              onBargeIn={triggerBargeIn}
              src={message.audio.src}
            />
            <p className="mt-1 text-[11px] text-ink-mute">Swipe left on the wave to barge-in</p>
          </div>
        )}

        <footer className="mt-2 flex items-center justify-between gap-3 text-[11px] opacity-70">
          <div className="flex min-w-0 items-center gap-2">
            <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
            {!isUser && !isSystem && message.model && (
              <span
                className="truncate rounded-full bg-teal-mist px-2 py-0.5 font-semibold text-teal"
                title={message.model}
              >
                {formatModelLabel(message.providerId, message.model)}
              </span>
            )}
          </div>
          {!isUser && !isSystem && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium hover:text-teal"
                aria-label="Speak this reply aloud"
                onClick={() => toggleSpeak(message.content)}
              >
                <Volume2 className="size-3" />
                {isSpeaking(message.content) ? "Stop" : "Speak"}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium hover:text-teal"
                onClick={() =>
                  setQuote({
                    messageId: message.id,
                    excerpt: message.content.replace(/\s+/g, " ").slice(0, 140),
                  })
                }
              >
                <Quote className="size-3" />
                Quote
              </button>
            </div>
          )}
        </footer>
      </div>

      {viewing && <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </motion.article>
  );
}
