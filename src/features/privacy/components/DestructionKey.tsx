import { hardPurgeLocalData } from "@/features/privacy/lib/hardPurge";
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
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const SLOT = "drop-destroy-slot";
const HOLD_MS = 3000;

function Key({ seated }: { seated: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: "destruction-key",
    disabled: seated,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      className={cn(
        "h-12 rounded-xl bg-danger px-4 text-sm font-bold text-white shadow-[var(--shadow-float)]",
        seated && "invisible",
        isDragging && "opacity-40",
      )}
      {...listeners}
      {...attributes}
    >
      Red destruction key
    </button>
  );
}

function Slot({
  seated,
  holding,
  progress,
  onHoldStart,
  onHoldEnd,
}: {
  seated: boolean;
  holding: boolean;
  progress: number;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: SLOT });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-16 flex-1 items-center justify-center rounded-2xl border-2 border-dashed",
        seated ? "border-danger bg-danger-mist" : "border-danger/30 bg-white",
        isOver && "drop-glow",
      )}
    >
      {seated ? (
        <button
          type="button"
          onPointerDown={onHoldStart}
          onPointerUp={onHoldEnd}
          onPointerLeave={onHoldEnd}
          className="relative h-12 w-[min(100%,220px)] overflow-hidden rounded-xl bg-danger text-sm font-bold text-white"
        >
          <span
            className="absolute inset-y-0 left-0 bg-black/25"
            style={{ width: `${progress * 100}%` }}
          />
          <span className="relative">{holding ? "Hold to erase…" : "Hold 3 seconds to purge"}</span>
        </button>
      ) : (
        <span className="text-xs font-semibold uppercase tracking-wide text-danger/70">Drop key into slot</span>
      )}
    </div>
  );
}

const CONFIRM = "HAPUS SELURUH DATA SAYA";

export function DestructionKey() {
  const [phrase, setPhrase] = useState("");
  const unlocked = phrase.trim().toUpperCase() === CONFIRM;
  const [seated, setSeated] = useState(false);
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const navigate = useNavigate();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const timer = useState<{ raf: number | null; start: number }>({ raf: null, start: 0 })[0];

  const stopHold = () => {
    setHolding(false);
    setProgress(0);
    if (timer.raf) cancelAnimationFrame(timer.raf);
    timer.raf = null;
  };

  const startHold = () => {
    setHolding(true);
    timer.start = performance.now();
    const tick = (now: number) => {
      const ratio = Math.min(1, (now - timer.start) / HOLD_MS);
      setProgress(ratio);
      if (ratio >= 1) {
        hardPurgeLocalData();
        navigate("/auth");
        return;
      }
      timer.raf = requestAnimationFrame(tick);
    };
    timer.raf = requestAnimationFrame(tick);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={() => setDragging(true)}
      onDragEnd={(e) => {
        setDragging(false);
        if (unlocked && e.over?.id === SLOT) setSeated(true);
      }}
      onDragCancel={() => setDragging(false)}
    >
      <label className="mb-3 block text-xs font-semibold uppercase tracking-wide text-danger">
        Type {CONFIRM}
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-danger/30 px-3 text-sm text-ink outline-none focus:border-danger"
        />
      </label>
      <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", !unlocked && "pointer-events-none opacity-40")}>
        <Slot
          seated={seated}
          holding={holding}
          progress={progress}
          onHoldStart={startHold}
          onHoldEnd={stopHold}
        />
        <Key seated={seated} />
      </div>
      <DragOverlay dropAnimation={springDropAnimation}>
        {dragging && !seated ? (
          <div className="h-12 rounded-xl bg-danger px-4 text-sm font-bold leading-[48px] text-white">
            Red destruction key
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
