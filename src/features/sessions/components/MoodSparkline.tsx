import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { useMemo, useRef } from "react";

export function MoodSparkline() {
  const sessions = useSessionStore((s) => s.sessions);
  const highlight = useSessionStore((s) => s.highlight);
  const highlightedId = useSessionStore((s) => s.highlightedId);
  const svgRef = useRef<SVGSVGElement>(null);

  const series = useMemo(
    () =>
      [...sessions].sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt)),
    [sessions],
  );

  const width = 640;
  const height = 88;
  const pad = 16;

  const points = series.map((session, i) => {
    const x = pad + (i / Math.max(1, series.length - 1)) * (width - pad * 2);
    const y = height - pad - (session.mood / 10) * (height - pad * 2);
    return { session, x, y };
  });

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const active = points.find((p) => p.session.id === highlightedId) ?? null;

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    let nearest = points[0];
    let best = Infinity;
    for (const point of points) {
      const dist = Math.abs(point.x - x);
      if (dist < best) {
        best = dist;
        nearest = point;
      }
    }
    highlight(nearest.session.id);
    document
      .querySelector(`[data-session-card="${nearest.session.id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="rounded-[1.4rem] bg-white p-4 ring-1 ring-line">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink-mute">
          Mood time-series
        </p>
        <p className="text-[11px] text-ink-mute">
          {active ? `${active.session.title} · ${active.session.mood}/10` : "Drag the scrubber"}
        </p>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-24 w-full touch-none cursor-ew-resize"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) pick(e.clientX);
        }}
        role="slider"
        aria-label="Mood sparkline scrubber"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={active?.session.mood ?? 0}
      >
        <path d={d} fill="none" stroke="#0D9488" strokeWidth="2.5" strokeLinecap="round" />
        {points.map((point) => (
          <circle
            key={point.session.id}
            cx={point.x}
            cy={point.y}
            r={point.session.id === highlightedId ? 6 : 3.5}
            fill={point.session.id === highlightedId ? "#0F172A" : "#0D9488"}
          />
        ))}
        {active && (
          <line x1={active.x} x2={active.x} y1={8} y2={height - 8} stroke="#0F172A" strokeDasharray="3 4" />
        )}
      </svg>
    </div>
  );
}
