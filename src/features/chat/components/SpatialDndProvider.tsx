import { useChatStore } from "@/features/chat/store/chatStore";
import type { ChatMessage, CoreMemory } from "@/features/chat/types";
import { DROP_ZONES, springDropAnimation } from "@/shared/lib/dnd";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

interface SpatialDndProviderProps {
  children: ReactNode;
}

type ActiveDrag =
  | { kind: "memory"; memory: CoreMemory }
  | { kind: "bubble"; message: ChatMessage }
  | { kind: "other" }
  | null;

export function SpatialDndProvider({ children }: SpatialDndProviderProps) {
  const injectMemory = useChatStore((s) => s.injectMemory);
  const setQuote = useChatStore((s) => s.setQuote);
  const setActiveDropZone = useChatStore((s) => s.setActiveDropZone);
  const [active, setActive] = useState<ActiveDrag>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "memory-card") {
      setActive({ kind: "memory", memory: data.memory as CoreMemory });
      return;
    }
    if (data?.type === "chat-bubble") {
      setActive({ kind: "bubble", message: data.message as ChatMessage });
      return;
    }
    setActive({ kind: "other" });
  };

  const onDragOver = (event: DragOverEvent) => {
    setActiveDropZone(event.over?.id ? String(event.over.id) : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id ? String(event.over.id) : null;
    const data = event.active.data.current;
    setActive(null);
    setActiveDropZone(null);
    if (!overId || !data) return;

    if (data.type === "memory-card" && data.memory) {
      if (overId === DROP_ZONES.CHAT_STREAM || overId === DROP_ZONES.COMPOSER) {
        injectMemory(data.memory as CoreMemory);
      }
    }

    if (data.type === "chat-bubble" && data.message) {
      if (overId === DROP_ZONES.COMPOSER) {
        const message = data.message as ChatMessage;
        setQuote({
          messageId: message.id,
          excerpt: message.content.replace(/\s+/g, " ").slice(0, 160),
        });
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setActiveDropZone(null);
      }}
    >
      {children}
      <DragOverlay dropAnimation={springDropAnimation} modifiers={[snapCenterToCursor]}>
        {active?.kind === "memory" ? (
          <div className="w-[220px] rounded-2xl bg-white p-3.5 shadow-[var(--shadow-float)] ring-2 ring-teal">
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-teal">
              <Sparkles className="size-3" />
              Inject
            </p>
            <p className="mt-1 font-display text-sm font-semibold">{active.memory.title}</p>
          </div>
        ) : active?.kind === "bubble" ? (
          <div className="max-w-xs rounded-2xl bg-white px-3 py-2 text-sm shadow-[var(--shadow-float)] ring-2 ring-teal">
            Quote & reply
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
