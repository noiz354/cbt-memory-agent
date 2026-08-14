import { GRID_SIZE, snapToGrid } from "@/shared/lib/dnd";
import { nodeSize, type AlignmentGuide, type GraphNode } from "@/features/memory/types";

const SNAP = 10;

export function nodeCenter(node: GraphNode) {
  const { w, h } = nodeSize(node.weight);
  return { x: node.x + w / 2, y: node.y + h / 2 };
}

export function snapWithGuides(
  draft: { x: number; y: number },
  selfId: string,
  nodes: GraphNode[],
): { x: number; y: number; guides: AlignmentGuide } {
  const self = nodes.find((n) => n.id === selfId);
  const { w, h } = nodeSize(self?.weight ?? 0.6);
  let x = draft.x;
  let y = draft.y;
  let vertical: number | null = null;
  let horizontal: number | null = null;

  for (const node of nodes) {
    if (node.id === selfId) continue;
    const size = nodeSize(node.weight);
    const pairsX = [
      [draft.x, node.x],
      [draft.x + w / 2, node.x + size.w / 2],
      [draft.x + w, node.x + size.w],
    ];
    const pairsY = [
      [draft.y, node.y],
      [draft.y + h / 2, node.y + size.h / 2],
      [draft.y + h, node.y + size.h],
    ];
    for (const [a, b] of pairsX) {
      if (Math.abs(a - b) < SNAP) {
        x = draft.x + (b - a);
        vertical = b;
      }
    }
    for (const [a, b] of pairsY) {
      if (Math.abs(a - b) < SNAP) {
        y = draft.y + (b - a);
        horizontal = b;
      }
    }
  }

  if (vertical == null) x = snapToGrid(x, GRID_SIZE);
  if (horizontal == null) y = snapToGrid(y, GRID_SIZE);

  return { x, y, guides: { vertical, horizontal } };
}

export function bezier(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = Math.abs(b.x - a.x) * 0.4;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function boundsOf(nodes: GraphNode[]) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const { w, h } = nodeSize(node.weight);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + w);
    maxY = Math.max(maxY, node.y + h);
  }
  return { minX, minY, maxX, maxY };
}
