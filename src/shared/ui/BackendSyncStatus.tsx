import { cn } from "@/shared/lib/cn";
import { RefreshCw } from "lucide-react";

interface BackendSyncStatusProps {
  hydrating: boolean;
  hydrateError: string | null;
  empty: boolean;
  emptyTitle: string;
  emptyHint: string;
  onRetry: () => void;
  className?: string;
}

/**
 * BackendSyncStatus — status bar + empty state untuk data yang di-hydrate
 * dari backend (CockroachDB). Menampilkan:
 * - hydrating → "Syncing from backend…"
 * - hydrateError → pesan error + tombol retry
 * - empty (server return kosong) → empty state bermakna
 */
export function BackendSyncStatus({
  hydrating,
  hydrateError,
  empty,
  emptyTitle,
  emptyHint,
  onRetry,
  className,
}: BackendSyncStatusProps) {
  if (hydrating) {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs font-medium text-ink-mute",
          className,
        )}
      >
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-teal" />
        Syncing from backend…
      </div>
    );
  }

  if (hydrateError) {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          Sync failed: {hydrateError} — showing local data.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (empty) {
    return (
      <div
        role="status"
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-white/60 px-6 py-10 text-center",
          className,
        )}
      >
        <p className="font-display text-sm font-bold text-ink">{emptyTitle}</p>
        <p className="max-w-sm text-xs text-ink-mute">{emptyHint}</p>
      </div>
    );
  }

  return null;
}
