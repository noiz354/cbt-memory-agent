export type MemoryKind = "core" | "transcript";

export interface GraphNode {
  id: string;
  kind: MemoryKind;
  title: string;
  excerpt: string;
  tags: string[];
  weight: number;
  lastTouched: string;
  x: number;
  y: number;
  confidence?: number;
  verified?: boolean;
  references?: number;
  crisisFlag?: boolean;
}

export function nodeConfidence(node: GraphNode) {
  return node.confidence ?? node.weight;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  createdAt: string;
}

export interface AlignmentGuide {
  vertical: number | null;
  horizontal: number | null;
}

export function nodeSize(weight: number) {
  return {
    w: Math.round(176 + weight * 72),
    h: Math.round(112 + weight * 32),
  };
}

export function nodeScale(weight: number) {
  return 0.7 + weight * 0.38;
}
