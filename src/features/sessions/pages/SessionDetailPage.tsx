import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { downloadJson } from "@/features/privacy/lib/exportBundle";
import { apiClient } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { formatClock, formatDay } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { cn } from "@/shared/lib/cn";
import { ArrowLeft, Download, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

interface Turn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokensUsed: number;
  injectedMemoryIds: string[];
  createdAt: string;
}

export function SessionDetailPage() {
  const { sessionId } = useParams();
  const session = useSessionStore((s) => s.sessions.find((item) => item.id === sessionId));
  const navigate = useNavigate();
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [turnsError, setTurnsError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setTurns(null);
    setTurnsError(null);
    const auth = getAuthHeaders();
    if (!auth) {
      setTurnsError("No active session — transcript unavailable.");
      return;
    }
    apiClient
      .listSessionTurns(sessionId, auth.token, auth.deviceId)
      .then((res) => setTurns(res.turns))
      .catch((err) => setTurnsError(err instanceof Error ? err.message : "Failed to load transcript"));
  }, [sessionId]);

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

      <section className="mt-6 rounded-[1.4rem] bg-white p-5 ring-1 ring-line">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-ink-mute">
          Transcript · {turns === null ? "loading" : turns.length} turns
        </h2>
        {turnsError ? (
          <p className="mt-3 text-sm text-amber-700">{turnsError}</p>
        ) : turns === null ? (
          <p className="mt-3 text-sm text-ink-mute">Loading chat history…</p>
        ) : turns.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">
            No synced turns for this session. Turns are written to CockroachDB on each chat exchange.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={cn(
                  "rounded-2xl px-4 py-3",
                  turn.role === "user"
                    ? "ml-auto max-w-[85%] bg-ink text-white"
                    : turn.role === "system"
                      ? "bg-danger-mist text-ink ring-1 ring-danger/30"
                      : "mr-auto max-w-[85%] bg-canvas text-ink",
                )}
              >
                <div className="mb-1 flex items-center justify-between text-[11px] opacity-70">
                  <span className="uppercase tracking-wide">{turn.role}</span>
                  <time dateTime={turn.createdAt}>{formatClock(turn.createdAt)}</time>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">{turn.content}</p>
                {turn.injectedMemoryIds.length > 0 && (
                  <p className="mt-1 text-[11px] text-teal">Recalled {turn.injectedMemoryIds.length} memories</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => navigate(`/chat?session=${encodeURIComponent(sessionId)}`)}>
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
