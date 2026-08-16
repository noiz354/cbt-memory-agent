/**
 * Analytics display formatting — pure helpers for the analytics UI.
 */

export function formatRate(rate: number | null): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

/** Funnel step progress in [0, 100]; falls back to 0 when no users yet. */
export function stepProgress(users: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((users / max) * 100));
}
