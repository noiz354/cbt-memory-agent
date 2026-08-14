import { SessionCard } from "@/features/sessions/components/SessionCard";
import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { formatDay } from "@/shared/lib/format";

export function TimelineView() {
  const sessions = useSessionStore((s) => s.sessions);
  const query = useSessionStore((s) => s.query);
  const statusFilter = useSessionStore((s) => s.statusFilter);
  const highlightedId = useSessionStore((s) => s.highlightedId);
  const q = query.trim().toLowerCase();
  const ordered = [...sessions]
    .filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!q) return true;
      return `${s.title} ${s.excerpt} ${s.thought}`.toLowerCase().includes(q);
    })
    .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));

  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {ordered.map((session) => (
        <li key={session.id} className="relative">
          <span className="absolute -left-[25px] top-4 size-2.5 rounded-full bg-teal" />
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
            {formatDay(session.startedAt)}
          </p>
          <SessionCard session={session} highlighted={highlightedId === session.id} />
        </li>
      ))}
    </ol>
  );
}
