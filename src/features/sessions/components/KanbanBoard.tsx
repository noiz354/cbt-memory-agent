import { SessionCard } from "@/features/sessions/components/SessionCard";
import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { cn } from "@/shared/lib/cn";
import type { SessionStatus } from "@/shared/types";
import { useDroppable } from "@dnd-kit/core";

const COLUMNS: { id: SessionStatus; label: string }[] = [
  { id: "extracted", label: "Extracted" },
  { id: "pending", label: "Pending" },
  { id: "interrupted", label: "Interrupted" },
];

function Column({ id, label, children }: { id: SessionStatus; label: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${id}`,
    data: { type: "session-column", status: id },
  });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-h-[280px] flex-col gap-2 rounded-[1.4rem] bg-canvas/80 p-3 ring-1 ring-line",
        isOver && "drop-glow",
      )}
    >
      <h2 className="px-1 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-mute">
        {label}
      </h2>
      {children}
    </section>
  );
}

export function KanbanBoard() {
  const sessions = useSessionStore((s) => s.sessions);
  const query = useSessionStore((s) => s.query);
  const statusFilter = useSessionStore((s) => s.statusFilter);
  const highlightedId = useSessionStore((s) => s.highlightedId);
  const q = query.trim().toLowerCase();
  const visible = sessions.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (!q) return true;
    return `${s.title} ${s.excerpt} ${s.thought}`.toLowerCase().includes(q);
  });

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {COLUMNS.map((col) => (
        <Column key={col.id} id={col.id} label={col.label}>
          {visible
            .filter((s) => s.status === col.id)
            .map((session) => (
              <SessionCard key={session.id} session={session} highlighted={highlightedId === session.id} />
            ))}
        </Column>
      ))}
    </div>
  );
}
