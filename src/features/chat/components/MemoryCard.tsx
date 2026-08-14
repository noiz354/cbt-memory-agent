import type { CoreMemory } from "@/features/chat/types";
import { cn } from "@/shared/lib/cn";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface MemoryCardProps {
  memory: CoreMemory;
}

export function MemoryCard({ memory }: MemoryCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `memory:${memory.id}`,
    data: { type: "memory-card", memory },
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <motion.button
      type="button"
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      layout
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "w-[220px] shrink-0 cursor-grab rounded-2xl bg-white p-3.5 text-left shadow-[var(--shadow-glass)] ring-1 ring-line active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-teal">
          <Sparkles className="size-3" />
          Core memory
        </span>
        <span className="text-[11px] text-ink-mute">{Math.round(memory.weight * 100)}%</span>
      </div>
      <p className="font-display text-sm font-semibold text-ink">{memory.title}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-mute">{memory.excerpt}</p>
      <div className="mt-2.5 flex flex-wrap gap-1">
        {memory.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-ink-mute">
            {tag}
          </span>
        ))}
      </div>
    </motion.button>
  );
}
