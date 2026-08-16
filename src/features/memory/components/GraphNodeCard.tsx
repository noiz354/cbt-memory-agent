import type { GraphNode } from "@/features/memory/types";
import { nodeSize } from "@/features/memory/types";
import { cn } from "@/shared/lib/cn";
import { motion } from "framer-motion";
import { FileText, Image, Sparkles } from "lucide-react";

interface GraphNodeCardProps {
  node: GraphNode;
  selected: boolean;
  linking: boolean;
  burning: boolean;
  dragging: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

export function GraphNodeCard({
  node,
  selected,
  linking,
  burning,
  dragging,
  onPointerDown,
}: GraphNodeCardProps) {
  const { w, h } = nodeSize(node.weight);
  const decaying = node.weight < 0.45;
  const CoreIcon = node.kind === "core" ? Sparkles : node.kind === "attachment" ? Image : FileText;
  const kindLabel = node.kind === "core" ? "Core" : node.kind === "attachment" ? "Attachment" : "Chunk";

  return (
    <motion.button
      type="button"
      data-no-pan
      data-graph-node={node.id}
      onPointerDown={onPointerDown}
      initial={false}
      animate={{
        x: node.x,
        y: node.y,
        opacity: burning ? 0 : decaying ? 0.62 : 1,
        scale: burning ? 0.2 : 1,
        rotate: burning ? 18 : 0,
      }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "absolute left-0 top-0 cursor-grab touch-none rounded-2xl p-3.5 text-left shadow-[var(--shadow-glass)] ring-1 active:cursor-grabbing",
        node.kind === "core" ? "bg-white ring-line" : "bg-mist ring-line",
        selected && "ring-2 ring-teal shadow-[var(--shadow-float)]",
        linking && "drop-glow ring-2 ring-teal",
        decaying && "border border-dashed border-ink/20",
        dragging && "pointer-events-none z-20",
        burning && "pointer-events-none bg-danger text-white ring-danger",
      )}
      style={{ width: w, height: h, left: node.x, top: node.y }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em]",
            node.kind === "core" ? "text-teal" : "text-ink-mute",
          )}
        >
          <CoreIcon className="size-3" />
          {kindLabel}
        </span>
        <span className="text-[10px] font-semibold text-ink-mute">{Math.round(node.weight * 100)}%</span>
      </div>
      <p className="font-display text-[13px] font-bold leading-snug text-ink line-clamp-2">{node.title}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-mute">{node.excerpt}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {decaying && (
          <span className="rounded-full bg-ink/6 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-mute">
            Decaying
          </span>
        )}
        {(node.confidence ?? node.weight) < 0.6 && !node.verified && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            Unverified
          </span>
        )}
        {node.crisisFlag && (
          <span className="rounded-full bg-danger-mist px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
            Crisis
          </span>
        )}
      </div>
    </motion.button>
  );
}
