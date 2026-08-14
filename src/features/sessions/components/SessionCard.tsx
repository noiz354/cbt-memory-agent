import type { TherapySession } from "@/features/sessions/types";
import { cn } from "@/shared/lib/cn";
import { formatDay } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

interface SessionCardProps {
  session: TherapySession;
  highlighted?: boolean;
}

const statusTone = {
  extracted: "success",
  pending: "ink",
  interrupted: "danger",
} as const;

export function SessionCard({ session, highlighted }: SessionCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef: setDrag, transform, isDragging } = useDraggable({
    id: `session:${session.id}`,
    data: { type: "session-card", sessionId: session.id },
  });
  const { setNodeRef: setDrop, isOver } = useDroppable({
    id: `session-target:${session.id}`,
    data: { type: "session-card", sessionId: session.id },
  });

  const setNodeRef = (node: HTMLElement | null) => {
    setDrag(node);
    setDrop(node);
  };

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <motion.article
      ref={setNodeRef}
      style={style}
      layout
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      data-session-card={session.id}
      className={cn(
        "cursor-grab rounded-2xl bg-white p-3.5 text-left shadow-[var(--shadow-glass)] ring-1 ring-line active:cursor-grabbing",
        highlighted && "ring-2 ring-teal drop-glow",
        isOver && "ring-2 ring-teal",
        isDragging && "opacity-40",
      )}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-sm font-bold leading-snug">{session.title}</h3>
        <Badge tone={statusTone[session.status]}>{session.status}</Badge>
      </div>
      <p className="mt-1 text-[11px] text-ink-mute">
        {formatDay(session.startedAt)} · {session.durationMin} min · {session.moodLabel}
      </p>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-mute">{session.excerpt}</p>
      <div className="mt-3">
        <div className="h-1 overflow-hidden rounded-full bg-canvas">
          <div className="h-full bg-teal" style={{ width: `${session.mood * 10}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-mute">
            Mood {session.mood}/10
          </p>
          <button
            type="button"
            className="text-[10px] font-bold uppercase tracking-wide text-teal"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              navigate("/chat");
            }}
          >
            Open detail
          </button>
        </div>
      </div>
    </motion.article>
  );
}
