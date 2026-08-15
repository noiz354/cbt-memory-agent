import { CompareModal } from "@/features/sessions/components/CompareModal";
import { KanbanBoard } from "@/features/sessions/components/KanbanBoard";
import { MoodSparkline } from "@/features/sessions/components/MoodSparkline";
import { TimelineView } from "@/features/sessions/components/TimelineView";
import { useSessionStore } from "@/features/sessions/store/sessionStore";
import type { SessionView } from "@/features/sessions/types";
import { cn } from "@/shared/lib/cn";
import { springDropAnimation } from "@/shared/lib/dnd";
import { BackendSyncStatus } from "@/shared/ui/BackendSyncStatus";
import type { SessionStatus } from "@/shared/types";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useRef, useState } from "react";

export function SessionsPage() {
  const [view, setView] = useState<SessionView>("kanban");
  const [pull, setPull] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const query = useSessionStore((s) => s.query);
  const setQuery = useSessionStore((s) => s.setQuery);
  const statusFilter = useSessionStore((s) => s.statusFilter);
  const setStatusFilter = useSessionStore((s) => s.setStatusFilter);
  const originY = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const setStatus = useSessionStore((s) => s.setStatus);
  const openCompare = useSessionStore((s) => s.openCompare);
  const retryInterrupted = useSessionStore((s) => s.retryInterrupted);
  const sessions = useSessionStore((s) => s.sessions);
  const hydrate = useSessionStore((s) => s.hydrate);
  const hydrated = useSessionStore((s) => s.hydrated);
  const hydrating = useSessionStore((s) => s.hydrating);
  const hydrateError = useSessionStore((s) => s.hydrateError);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const sessionId = event.active.data.current?.sessionId as string | undefined;
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!sessionId || !overId) return;
    if (overId.startsWith("session-target:")) {
      const other = overId.slice("session-target:".length);
      openCompare(sessionId, other);
      return;
    }
    if (overId.startsWith("col:")) {
      setStatus(sessionId, overId.slice(4) as SessionStatus);
    }
  };

  const onPointerDown = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-session-card]")) return;
    if (scroller.current && scroller.current.scrollTop <= 0) {
      originY.current = event.clientY;
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (originY.current == null) return;
    setPull(Math.max(0, Math.min(96, event.clientY - originY.current)));
  };
  const onPointerUp = () => {
    if (pull > 64) {
      const n = retryInterrupted();
      setToast(n ? `Re-queued ${n} interrupted session${n === 1 ? "" : "s"}.` : "Nothing interrupted to retry.");
      window.setTimeout(() => setToast(null), 2200);
    }
    originY.current = null;
    setPull(0);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div
        ref={scroller}
        className="h-full overflow-auto p-5"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
              Analytics
            </p>
            <h1 className="font-display text-2xl font-bold">Session history</h1>
            <p className="mt-1 text-sm text-ink-mute">
              {sessions.length} traces · pull down to retry interrupted sessions
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sessions…"
                className="h-9 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-teal"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | SessionStatus)}
                aria-label="Filter sessions by status"
                className="h-9 rounded-xl border border-line bg-white px-2 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="extracted">Extracted</option>
                <option value="pending">Pending</option>
                <option value="interrupted">Interrupted</option>
              </select>
            </div>
          </div>
          <div className="flex rounded-2xl bg-white p-1 ring-1 ring-line">
            {(["kanban", "timeline"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cn(
                  "h-9 rounded-xl px-3 text-sm font-semibold capitalize",
                  view === id ? "bg-ink text-white" : "text-ink-mute",
                )}
              >
                {id}
              </button>
            ))}
          </div>
        </header>

        {pull > 8 && (
          <p className="mb-3 text-center text-xs font-semibold text-teal">
            {pull > 64 ? "Release to retry interrupted" : "Pull to refresh"}
          </p>
        )}

        <BackendSyncStatus
          className="mb-3"
          hydrating={hydrating}
          hydrateError={hydrateError}
          empty={false}
          emptyTitle=""
          emptyHint=""
          onRetry={() => void hydrate()}
        />

        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_14rem]">
          <MoodSparkline />
          <KpiCard />
        </div>

        {hydrated && sessions.length === 0 ? (
          <BackendSyncStatus
            className="mt-4"
            hydrating={false}
            hydrateError={null}
            empty
            emptyTitle="No sessions yet"
            emptyHint="Completed therapy sessions will show up here — synced to CockroachDB. Each session trace captures mood, thought, and reframe."
            onRetry={() => void hydrate()}
          />
        ) : (
          <>
            {view === "kanban" ? <KanbanBoard /> : <TimelineView />}
          </>
        )}
        {toast && (
          <div className="fixed bottom-8 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white">
            {toast}
          </div>
        )}
      </div>
      <CompareModal />
      <DragOverlay dropAnimation={springDropAnimation}>
        <div className="w-64 rounded-2xl bg-white px-3 py-2 text-sm font-semibold shadow-[var(--shadow-float)] ring-2 ring-teal">
          Drop on a column to move · on a card to compare
        </div>
      </DragOverlay>
    </DndContext>
  );
}

function KpiCard() {
  const sessions = useSessionStore((s) => s.sessions);
  const delta = useMemo(() => {
    const ordered = [...sessions].sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt));
    if (ordered.length < 2) return 0;
    const mid = Math.floor(ordered.length / 2);
    const early = ordered.slice(0, mid).reduce((a, s) => a + s.mood, 0) / mid;
    const late = ordered.slice(mid).reduce((a, s) => a + s.mood, 0) / (ordered.length - mid);
    return Math.round((late - early) * 10);
  }, [sessions]);

  return (
    <div className="rounded-[1.4rem] bg-white p-4 ring-1 ring-line">
      <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-mute">
        Mood delta
      </p>
      <p className="mt-3 font-display text-3xl font-extrabold text-teal">
        {delta > 0 ? "+" : ""}
        {delta}%
      </p>
      <p className="mt-1 text-xs text-ink-mute">Later sessions vs earlier half · local only</p>
    </div>
  );
}
