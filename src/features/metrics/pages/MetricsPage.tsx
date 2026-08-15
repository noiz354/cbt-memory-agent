import { apiClient } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { Badge } from "@/shared/ui/Badge";
import { useEffect, useState } from "react";

interface MetricsPayload {
  v?: number;
  northStar?: {
    activeSessions?: number;
    chatTurns?: number;
    memoryNodes?: number;
    crisisEvents?: number;
  };
  metrics?: {
    sessions?: Record<string, number>;
    memory?: {
      nodes?: number;
      edges?: number;
      avgConfidence?: number | null;
      totalRefCount?: number;
    };
    audit?: Record<string, number>;
  };
  guardrails?: Record<string, unknown>;
  error?: string;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-mute">{sub}</p>}
    </div>
  );
}

export function MetricsPage() {
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    const auth = getAuthHeaders();
    if (!auth) {
      setError("No active session — metrics require an authenticated profile.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    apiClient
      .metrics(auth.token, auth.deviceId)
      .then((res) => {
        setData(res as MetricsPayload);
        if (res && typeof res === "object" && "error" in res) setError((res as MetricsPayload).error ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load metrics"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const north = data?.northStar ?? {};
  const mem = data?.metrics?.memory;
  const audit = data?.metrics?.audit ?? {};

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 px-4 py-3 md:px-5">
        <div>
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
            Clinical signals
          </p>
          <h1 className="font-display text-xl font-bold md:text-2xl">Metrics</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="teal">North star</Badge>
          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold hover:bg-canvas"
          >
            Refresh
          </button>
        </div>
      </header>

      {loading && <p className="px-5 text-sm text-ink-mute">Loading server metrics…</p>}
      {!loading && error && (
        <div className="mx-5 mt-2 rounded-xl bg-danger-mist px-4 py-3 text-sm text-ink">
          {error}
        </div>
      )}

      {!loading && data && (
        <div className="space-y-6 px-4 pb-6 md:px-5">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Active sessions" value={north.activeSessions ?? 0} />
            <StatCard label="Chat turns" value={north.chatTurns ?? 0} />
            <StatCard label="Memory nodes" value={north.memoryNodes ?? 0} />
            <StatCard label="Crisis events" value={north.crisisEvents ?? 0} />
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-white p-4">
              <h2 className="text-sm font-bold">Memory graph</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-mute">Nodes</dt>
                  <dd className="font-semibold tabular-nums">{mem?.nodes ?? 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-mute">Edges</dt>
                  <dd className="font-semibold tabular-nums">{mem?.edges ?? 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-mute">Avg confidence</dt>
                  <dd className="font-semibold tabular-nums">
                    {mem?.avgConfidence != null ? `${(mem.avgConfidence * 100).toFixed(0)}%` : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-mute">Total ref count</dt>
                  <dd className="font-semibold tabular-nums">{mem?.totalRefCount ?? 0}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-line bg-white p-4">
              <h2 className="text-sm font-bold">Sessions by status</h2>
              {data.metrics?.sessions && Object.keys(data.metrics.sessions).length > 0 ? (
                <dl className="mt-3 space-y-2 text-sm">
                  {Object.entries(data.metrics.sessions).map(([status, count]) => (
                    <div key={status} className="flex justify-between">
                      <dt className="capitalize text-ink-mute">{status}</dt>
                      <dd className="font-semibold tabular-nums">{count}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-ink-mute">No sessions recorded yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-4">
            <h2 className="text-sm font-bold">Audit events (server)</h2>
            {Object.keys(audit).length > 0 ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                {Object.entries(audit).map(([type, count]) => (
                  <div key={type} className="flex justify-between">
                    <dt className="text-ink-mute">{type}</dt>
                    <dd className="font-semibold tabular-nums">{count}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-ink-mute">
                No server audit events yet — events sync when the feature logs them.
              </p>
            )}
          </section>
        </div>
      )}

      {!loading && !error && !data && (
        <p className="px-5 text-sm text-ink-mute">No metrics returned.</p>
      )}
    </div>
  );
}
