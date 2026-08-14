import type { GraphEdge, GraphNode } from "@/features/memory/types";
import { uid } from "@/shared/lib/format";
import { createVersionedPersist } from "@/shared/lib/versionedPersist";
import { apiClient } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { metric } from "@/shared/lib/metrics";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MemoryState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  burningIds: string[];
  select: (id: string | null) => void;
  moveNode: (id: string, x: number, y: number) => void;
  linkNodes: (source: string, target: string, label?: string) => boolean;
  unlink: (edgeId: string) => void;
  startPurge: (id: string) => void;
  finishPurge: (id: string) => void;
  touch: (id: string) => void;
  verify: (id: string) => void;
  updateNode: (id: string, patch: { title?: string; excerpt?: string }) => void;
  touchRecall: (id: string) => void;
  wipe: () => void;
}

const seedNodes: GraphNode[] = [
  {
    id: "mem_breath",
    kind: "core",
    title: "Sunday kitchen spiral",
    excerpt: "Catastrophizing after a delayed text. Body: tight chest, 7/10.",
    tags: ["anxiety", "automatic thought"],
    weight: 0.86,
    confidence: 0.91,
    verified: true,
    references: 4,
    lastTouched: "2026-08-11T09:20:00.000Z",
    x: 140,
    y: 120,
  },
  {
    id: "mem_reframe",
    kind: "core",
    title: "Reappraisal that landed",
    excerpt: "“Delay ≠ rejection.” Evidence: three prior late-but-warm replies.",
    tags: ["reframe", "evidence"],
    weight: 0.72,
    confidence: 0.88,
    verified: true,
    references: 2,
    lastTouched: "2026-08-10T16:02:00.000Z",
    x: 460,
    y: 60,
  },
  {
    id: "mem_sleep",
    kind: "core",
    title: "2 a.m. rumination loop",
    excerpt: "Replayed the meeting. Sleep onset 94 min. Used 4-7-8 twice.",
    tags: ["sleep", "rumination"],
    weight: 0.54,
    confidence: 0.71,
    verified: true,
    references: 1,
    lastTouched: "2026-08-08T02:14:00.000Z",
    x: 260,
    y: 360,
  },
  {
    id: "chunk_slack",
    kind: "transcript",
    title: "Slack thread replay",
    excerpt: "Three unsent drafts. The thought: I will sound incompetent.",
    tags: ["transcript", "situation"],
    weight: 0.64,
    lastTouched: "2026-08-13T08:03:12.000Z",
    x: 680,
    y: 200,
  },
  {
    id: "chunk_thought",
    kind: "transcript",
    title: "Hot cognition",
    excerpt: "If I send the wrong thing, I’ll damage the relationship.",
    tags: ["transcript", "thought"],
    weight: 0.48,
    lastTouched: "2026-08-13T08:03:40.000Z",
    x: 500,
    y: 340,
  },
  {
    id: "chunk_body",
    kind: "transcript",
    title: "Chest tightness 7/10",
    excerpt: "Shoulders up. Breath high. The body arrived before the sentence.",
    tags: ["transcript", "soma"],
    weight: 0.31,
    lastTouched: "2026-08-08T02:14:00.000Z",
    x: 40,
    y: 400,
  },
  {
    id: "chunk_evidence",
    kind: "transcript",
    title: "Three warm late replies",
    excerpt: "Prior data contradicts the catastrophe. Delay is not rejection.",
    tags: ["transcript", "evidence"],
    weight: 0.41,
    lastTouched: "2026-08-10T16:02:00.000Z",
    x: 760,
    y: 40,
  },
];

const seedEdges: GraphEdge[] = [
  {
    id: "e1",
    source: "mem_breath",
    target: "chunk_slack",
    label: "situation",
    createdAt: "2026-08-13T08:04:00.000Z",
  },
  {
    id: "e2",
    source: "mem_breath",
    target: "mem_reframe",
    label: "reappraisal",
    createdAt: "2026-08-11T10:00:00.000Z",
  },
  {
    id: "e3",
    source: "chunk_thought",
    target: "mem_breath",
    label: "same loop",
    createdAt: "2026-08-13T08:04:10.000Z",
  },
  {
    id: "e4",
    source: "mem_sleep",
    target: "chunk_body",
    label: "soma",
    createdAt: "2026-08-08T02:20:00.000Z",
  },
  {
    id: "e5",
    source: "mem_reframe",
    target: "chunk_evidence",
    label: "evidence",
    createdAt: "2026-08-10T16:10:00.000Z",
  },
];

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set, get) => ({
      nodes: seedNodes,
      edges: seedEdges,
      selectedId: null,
      burningIds: [],
      select: (selectedId) => set({ selectedId }),
      moveNode: (id, x, y) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
        })),
      linkNodes: (source, target, label = "custom") => {
        if (source === target) return false;
        const exists = get().edges.some(
          (e) =>
            (e.source === source && e.target === target) ||
            (e.source === target && e.target === source),
        );
        if (exists) return false;

        const edgeId = uid("edge");
        const newEdge = {
          id: edgeId,
          source,
          target,
          label,
          createdAt: new Date().toISOString(),
        };

        set((s) => ({
          edges: [...s.edges, newEdge],
        }));

        // Sync to backend — fire and forget
        const auth = getAuthHeaders();
        if (auth) {
          apiClient.upsertMemory(
            { v: 1, action: "upsert", edge: newEdge },
            auth.token,
            auth.deviceId,
          ).catch((err) => console.warn("[API] Failed to sync edge to backend:", err));
        }

        metric.graphLinkCreated();
        return true;
      },
      unlink: (edgeId) => set((s) => ({ edges: s.edges.filter((e) => e.id !== edgeId) })),
      startPurge: (id) =>
        set((s) => ({
          burningIds: s.burningIds.includes(id) ? s.burningIds : [...s.burningIds, id],
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),
      finishPurge: (id) => {
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => e.source !== id && e.target !== id),
          burningIds: s.burningIds.filter((b) => b !== id),
        }));

        // Sync to backend — fire and forget
        const auth = getAuthHeaders();
        if (auth) {
          apiClient.deleteMemory(id, auth.token, auth.deviceId)
            .catch((err) => console.warn("[API] Failed to purge node from backend:", err));
        }

        metric.purgeFromGraph();
      },
      touch: (id) =>
        set((s) => ({
          selectedId: id,
          nodes: s.nodes.map((n) =>
            n.id === id ? { ...n, lastTouched: new Date().toISOString() } : n,
          ),
        })),
      verify: (id) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, verified: true, confidence: Math.max(n.confidence ?? 0, 0.7) } : n)),
        })),
      updateNode: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch, lastTouched: new Date().toISOString() } : n)),
        })),
      touchRecall: (id) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id ? { ...n, references: (n.references ?? 0) + 1, lastTouched: new Date().toISOString() } : n,
          ),
        })),
      wipe: () => set({ nodes: [], edges: [], selectedId: null, burningIds: [] }),
    }),
    createVersionedPersist<MemoryState, { nodes: GraphNode[]; edges: GraphEdge[] }>({
      name: "cbt-memory-graph",
      partialize: (s) => ({ nodes: s.nodes, edges: s.edges }),
    }),
  ),
);

export function coreMemories() {
  return useMemoryStore.getState().nodes.filter((n) => n.kind === "core");
}
