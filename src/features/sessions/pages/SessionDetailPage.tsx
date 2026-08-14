import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { downloadJson } from "@/features/privacy/lib/exportBundle";
import { formatDay } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { ArrowLeft, Download, MessageSquareText } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

export function SessionDetailPage() {
  const { sessionId } = useParams();
  const session = useSessionStore((s) => s.sessions.find((item) => item.id === sessionId));
  const navigate = useNavigate();

  if (!sessionId) return <Navigate to="/sessions" replace />;
  if (!session) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink-mute">Session not on this device.</p>
        <Link to="/sessions" className="mt-3 inline-block text-sm font-semibold text-teal">
          Back to history
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-5">
      <button
        type="button"
        onClick={() => navigate("/sessions")}
        className="inline-flex items-center gap-1 text-sm font-semibold text-ink-mute"
      >
        <ArrowLeft className="size-4" />
        History
      </button>
      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
            Session detail
          </p>
          <h1 className="font-display text-2xl font-bold">{session.title}</h1>
          <p className="mt-1 text-sm text-ink-mute">
            {formatDay(session.startedAt)} · {session.durationMin} min · {session.moodLabel}
          </p>
        </div>
        <Badge tone={session.status === "extracted" ? "success" : session.status === "interrupted" ? "danger" : "ink"}>
          {session.status}
        </Badge>
      </header>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-[1.4rem] bg-white p-5 ring-1 ring-line">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-ink-mute">Automatic thought</h2>
          <p className="mt-2 text-sm leading-7">{session.thought}</p>
        </article>
        <article className="rounded-[1.4rem] bg-white p-5 ring-1 ring-line">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-ink-mute">Reframe</h2>
          <p className="mt-2 text-sm leading-7">{session.reframe ?? "Still open — not extracted."}</p>
        </article>
        <article className="rounded-[1.4rem] bg-white p-5 ring-1 ring-line md:col-span-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-ink-mute">Excerpt</h2>
          <p className="mt-2 text-sm leading-7 text-ink-mute">{session.excerpt}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-canvas">
            <div className="h-full bg-teal" style={{ width: `${session.mood * 10}%` }} />
          </div>
          <p className="mt-1 text-xs text-ink-mute">Mood {session.mood}/10</p>
        </article>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => navigate("/chat")}>
          <MessageSquareText className="size-4" />
          Continue similar conversation
        </Button>
        <Button variant="ghost" onClick={() => downloadJson(session, `session-${session.id}.json`)}>
          <Download className="size-4" />
          Export this session
        </Button>
      </div>
    </div>
  );
}
