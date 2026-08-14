import type { GoalDefinition } from "@/features/auth/types";
import { cn } from "@/shared/lib/cn";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { GripHorizontal } from "lucide-react";

interface GoalChipProps {
  goal: GoalDefinition;
  selected?: boolean;
  onToggle?: () => void;
}

export function GoalChip({ goal, selected = false, onToggle }: GoalChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `goal:${goal.id}`,
    data: { type: "goal-chip", goalId: goal.id, selected },
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <motion.button
      type="button"
      ref={setNodeRef}
      style={style}
      layout
      onClick={onToggle}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl p-3.5 text-left ring-1 transition-colors",
        selected
          ? "bg-teal-mist ring-teal/40 text-ink"
          : "bg-white ring-line hover:ring-teal/40",
        isDragging && "opacity-40",
      )}
    >
      <span
        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink-mute"
        data-drag-handle
        {...listeners}
        {...attributes}
        aria-label={`Drag ${goal.label}`}
      >
        <GripHorizontal className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-sm font-bold">{goal.label}</span>
        <span className="mt-0.5 block text-xs font-medium text-teal">{goal.headline}</span>
        <span className="mt-1 block text-xs leading-5 text-ink-mute">{goal.detail}</span>
      </span>
    </motion.button>
  );
}
