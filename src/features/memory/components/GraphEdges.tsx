import { bezier, nodeCenter } from "@/features/memory/lib/geometry";
import type { GraphEdge, GraphNode } from "@/features/memory/types";

interface GraphEdgesProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlight?: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
}

export function GraphEdges({ nodes, edges, highlight }: GraphEdgesProps) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="edge-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0D9488" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#0F172A" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {edges.map((edge) => {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        if (!a || !b) return null;
        const ca = nodeCenter(a);
        const cb = nodeCenter(b);
        const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
        return (
          <g key={edge.id}>
            <path
              d={bezier(ca, cb)}
              fill="none"
              stroke="url(#edge-teal)"
              strokeWidth={2.2}
              strokeLinecap="round"
            />
            <text
              x={mid.x}
              y={mid.y - 8}
              textAnchor="middle"
              className="fill-ink-mute"
              style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}
            >
              {edge.label.toUpperCase()}
            </text>
          </g>
        );
      })}
      {highlight && (
        <path
          d={bezier(highlight.from, highlight.to)}
          fill="none"
          stroke="#0D9488"
          strokeWidth={2.4}
          strokeDasharray="7 6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
