import { apiClient } from "@/shared/lib/apiClient";
import { Badge } from "@/shared/ui/Badge";
import { useEffect, useState } from "react";
import { formatCount, formatRate, stepProgress } from "../lib/analyticsFormat";

interface FunnelPayload {
  v?: 1;
  period?: string;
  steps?: { name: string; users: number }[];
  conversion?: { from: string; to: string; rate: number | null }[];
}

interface ActivityPayload {
  v?: 1;
  period?: string;
  dau?: number;
  wau?: number;
  mau?: number;
  stickyFactor?: number | null;
}

interface RetentionPayload {
  v?: 1;
  period?: string;
  cohorts?: { cohort: string; age: number; size: number; active: number; retentionPct: number | null }[];
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

interface AnalyticsSectionProps {
  token: string;
  deviceId: string;
  refreshTick: number;
}

/**
 * AnalyticsSection — Funnel, Activity (DAU/WAU/MAU) and Retention cohort.
 * Backed by GET /analytics/funnel, /analytics/activity, /analytics/retention.
 */
export function AnalyticsSection({ token, deviceId, refreshTick }: AnalyticsSectionProps) {
  const [funnel, setFunnel] = useState<FunnelPayload | null>(null);
  const [activity, setActivity] = useState<ActivityPayload | null>(null);
  const [retention, setRetention] = useState<RetentionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      apiClient.analyticsFunnel(token, deviceId),
      apiClient.analyticsActivity(token, deviceId),
      apiClient.analyticsRetention(token, deviceId),
    ]).then(([f, a, r]) => {
      if (cancelled) return;
      if (f.status === "fulfilled") setFunnel(f.value as FunnelPayload);
      if (a.status === "fulfilled") setActivity(a.value as ActivityPayload);
      if (r.status === "fulfilled") setRetention(r.value as RetentionPayload);
      const rejected = [f, a, r].filter((x) => x.status === "rejected");
      if (rejected.length > 0) {
        const messages = rejected
          .map((x) => (x.status === "rejected" ? (x.reason instanceof Error ? x.reason.message : "Failed") : ""))
          .filter(Boolean);
        setError(messages.join(" · "));
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token, deviceId, refreshTick]);

  const steps = funnel?.steps ?? [];
  const conversion = funnel?.conversion ?? [];
  const maxUsers = Math.max(1, ...steps.map((s) => s.users));
  const cohorts = retention?.cohorts ?? [];
  const period = activity?.period ?? funnel?.period ?? retention?.period;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold">Product analytics</h2>
          <Badge tone="teal">Funnel · Activity · Retention</Badge>
        </div>
        {period && <p className="text-xs text-ink-mute">Period: {period}</p>}
      </div>

      {loading && <p className="text-sm text-ink-mute">Loading product analytics…</p>}
      {!loading && error && (
        <div className="rounded-xl bg-danger-mist px-4 py-3 text-sm text-ink">{error}</div>
      )}

      {!loading && !error && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-white p-4">
            <h3 className="text-sm font-bold">Activation funnel</h3>
            {steps.length > 0 ? (
              <div className="mt-3 space-y-3">
                {steps.map((s, idx) => (
                  <div key={s.name}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink-mute">{s.name}</span>
                      <span className="font-semibold tabular-nums">{formatCount(s.users)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/5">
                      <div
                        className="h-full rounded-full bg-teal transition-all"
                        style={{ width: `${stepProgress(s.users, maxUsers)}%` }}
                      />
                    </div>
                    {idx < steps.length - 1 && conversion[idx] && (
                      <p className="mt-1 text-[11px] text-ink-mute">
                        → {formatRate(conversion[idx].rate)} convert to {conversion[idx].to}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-mute">
                No funnel data yet — events sync as users complete steps.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="DAU" value={formatCount(activity?.dau)} />
              <StatCard label="WAU" value={formatCount(activity?.wau)} />
              <StatCard label="MAU" value={formatCount(activity?.mau)} />
              <StatCard label="Sticky" value={formatRate(activity?.stickyFactor ?? null)} />
            </div>

            <div className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-sm font-bold">Retention cohorts</h3>
              {cohorts.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {cohorts.map((c) => (
                    <div key={`${c.cohort}-${c.age}`} className="flex items-center justify-between text-sm">
                      <span className="text-ink-mute">
                        {c.cohort} · month {c.age}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {formatCount(c.active)}/{formatCount(c.size)} · {formatRate(c.retentionPct)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-ink-mute">
                  No cohorts yet — retention appears after users return across months.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
