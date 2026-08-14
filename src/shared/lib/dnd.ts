import type { DropAnimation } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

export const GRID_SIZE = 28;

export function snapToGrid(value: number, size = GRID_SIZE) {
  return Math.round(value / size) * size;
}

export const springDropAnimation: DropAnimation = {
  duration: 280,
  easing: "cubic-bezier(0.22, 1.2, 0.36, 1)",
  keyframes({ transform }) {
    return [
      { transform: CSS.Transform.toString(transform.initial) },
      { transform: CSS.Transform.toString(transform.final) },
    ];
  },
};

export const DND_TYPES = {
  MEMORY_CARD: "memory-card",
  CHAT_BUBBLE: "chat-bubble",
  SNAPSHOT: "snapshot",
  FILE: "file",
  SESSION_CARD: "session-card",
  GRAPH_NODE: "graph-node",
  EXPORT_CHIP: "export-chip",
} as const;

export type DndType = (typeof DND_TYPES)[keyof typeof DND_TYPES];

export const DROP_ZONES = {
  CHAT_STREAM: "drop-chat-stream",
  COMPOSER: "drop-composer",
  CANVAS: "drop-canvas",
  QUOTE: "drop-quote",
  PURGE: "drop-purge",
  EXPORT: "drop-export",
  VAULT: "drop-vault",
  GOAL_PALETTE: "drop-goal-palette",
} as const;
