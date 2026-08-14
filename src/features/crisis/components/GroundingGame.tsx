import { cn } from "@/shared/lib/cn";
import { springDropAnimation } from "@/shared/lib/dnd";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

const TOKENS = [
  { id: "sight", label: "Something I see" },
  { id: "touch", label: "Something I feel" },
  { id: "sound", label: "Something I hear" },
  { id: "air", label: "Air in this room" },
  { id: "name", label: "My own name" },
] as const;

const PADS = [1, 2, 3, 4, 5] as const;

type SeatMap = Record<number, string | null>;

function TokenChip({
  id,
  label,
  seated,
}: {
  id: string;
  label: string;
  seated: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `token:${id}`,
    data: { tokenId: id },
    disabled: seated,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      disabled={seated}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold",
        seated ? "bg-success/20 text-success" : "bg-white text-ink",
        isDragging && "opacity-40",
      )}
      {...listeners}
      {...attributes}
    >
      {label}
    </button>
  );
}

function Pad({
  n,
  tokenLabel,
}: {
  n: number;
  tokenLabel: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `pad:${n}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex size-[72px] flex-col items-center justify-center rounded-full border border-dashed text-center",
        tokenLabel ? "border-teal bg-teal/20 text-white" : "border-white/25 text-white/50",
        isOver && "drop-glow border-teal",
      )}
    >
      <span className="font-display text-sm font-bold">{n}</span>
      {tokenLabel && <span className="mt-0.5 max-w-[64px] truncate px-1 text-[9px]">{tokenLabel}</span>}
    </div>
  );
}

export function GroundingGame({ onComplete }: { onComplete?: () => void }) {
  const [seats, setSeats] = useState<SeatMap>({ 1: null, 2: null, 3: null, 4: null, 5: null });
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const seatedIds = useMemo(() => new Set(Object.values(seats).filter(Boolean) as string[]), [seats]);
  const complete = seatedIds.size === TOKENS.length;

  useEffect(() => {
    if (complete) onComplete?.();
  }, [complete, onComplete]);
  const active = TOKENS.find((t) => t.id === activeId) ?? null;

  const onDragEnd = (event: DragEndEvent) => {
    const tokenId = event.active.data.current?.tokenId as string | undefined;
    const over = event.over?.id ? String(event.over.id) : null;
    setActiveId(null);
    if (!tokenId || !over?.startsWith("pad:")) return;
    const pad = Number(over.slice(4)) as 1 | 2 | 3 | 4 | 5;
    setSeats((prev) => {
      const next = { ...prev };
      for (const key of PADS) {
        if (next[key] === tokenId) next[key] = null;
      }
      next[pad] = tokenId;
      return next;
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActiveId((e.active.data.current?.tokenId as string) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">
          Five-point distraction
        </p>
        <p className="mb-3 text-xs leading-5 text-white/60">
          Name five things that are here, now. Drag each chip onto a point.
        </p>
        <div className="mb-4 flex flex-wrap justify-center gap-x-6 gap-y-3">
          {PADS.map((n) => {
            const tokenId = seats[n];
            const label = TOKENS.find((t) => t.id === tokenId)?.label ?? null;
            return <Pad key={n} n={n} tokenLabel={label} />;
          })}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {TOKENS.map((token) => (
            <TokenChip key={token.id} id={token.id} label={token.label} seated={seatedIds.has(token.id)} />
          ))}
        </div>
        {complete && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="mt-3 text-center text-sm font-semibold text-teal-soft"
          >
            Five anchors seated. You are in this room, on this device, not in the thought.
          </motion.p>
        )}
      </div>
      <DragOverlay dropAnimation={springDropAnimation}>
        {active ? (
          <div className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-[var(--shadow-float)]">
            {active.label}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
