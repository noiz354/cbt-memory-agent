import { GoalChip } from "@/features/auth/components/GoalChip";
import { THERAPY_GOALS } from "@/features/auth/lib/goals";
import { useAuthStore } from "@/features/auth/store/authStore";
import { cn } from "@/shared/lib/cn";
import { DROP_ZONES, springDropAnimation } from "@/shared/lib/dnd";
import type { TherapyGoal } from "@/shared/types";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Lock, Sparkles } from "lucide-react";
import { useState } from "react";

const VAULT_ZONE = DROP_ZONES.VAULT;
const PALETTE_ZONE = DROP_ZONES.GOAL_PALETTE;

function Zone({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && "drop-glow")}>
      {children}
    </div>
  );
}

export function PersonalizedVault() {
  const profileGoals = useAuthStore((s) => s.profile?.goals);
  const goals = profileGoals ?? [];
  const addGoal = useAuthStore((s) => s.addGoal);
  const removeGoal = useAuthStore((s) => s.removeGoal);
  const toggleGoal = useAuthStore((s) => s.toggleGoal);
  const [activeId, setActiveId] = useState<TherapyGoal | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const selected = THERAPY_GOALS.filter((g) => goals.includes(g.id));
  const available = THERAPY_GOALS.filter((g) => !goals.includes(g.id));
  const activeGoal = THERAPY_GOALS.find((g) => g.id === activeId) ?? null;

  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id ? String(event.over.id) : null;
    const goalId = event.active.data.current?.goalId as TherapyGoal | undefined;
    setActiveId(null);
    if (!goalId || !overId) return;
    if (overId === VAULT_ZONE) addGoal(goalId);
    if (overId === PALETTE_ZONE) removeGoal(goalId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActiveId((e.active.data.current?.goalId as TherapyGoal) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Zone id={PALETTE_ZONE} className="rounded-[1.4rem] bg-canvas/80 p-3 ring-1 ring-line">
          <p className="mb-3 px-1 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-mute">
            Goal palette · drag in
          </p>
          <div className="grid gap-2">
            {available.map((goal) => (
              <GoalChip key={goal.id} goal={goal} onToggle={() => toggleGoal(goal.id)} />
            ))}
            {available.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-ink-mute">
                Every target is in the vault. Drag one back to edit.
              </p>
            )}
          </div>
        </Zone>

        <Zone
          id={VAULT_ZONE}
          className="rounded-[1.4rem] bg-ink p-3 text-white ring-1 ring-white/10"
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-teal-soft">
              <Lock className="size-3.5" />
              Personalized vault
            </p>
            <span className="text-[11px] text-white/50">{selected.length} seated</span>
          </div>
          <div className="grid min-h-[220px] gap-2">
            {selected.map((goal) => (
              <GoalChip key={goal.id} goal={goal} selected onToggle={() => toggleGoal(goal.id)} />
            ))}
            {selected.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center">
                <Sparkles className="size-5 text-teal-soft" />
                <p className="text-sm font-medium text-white/80">Drop therapy targets here</p>
                <p className="text-xs text-white/60">At least one goal is required to open the workspace.</p>
              </div>
            )}
          </div>
        </Zone>
      </div>

      <DragOverlay dropAnimation={springDropAnimation}>
        {activeGoal ? (
          <div className="w-[280px] rounded-2xl bg-white p-3 shadow-[var(--shadow-float)] ring-2 ring-teal">
            <p className="font-display text-sm font-bold">{activeGoal.label}</p>
            <p className="text-xs text-teal">{activeGoal.headline}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
