import { apiClient, type HealthResponse } from "@/shared/lib/apiClient";
import { cn } from "@/shared/lib/cn";
import { useEffect, useState } from "react";

type BackendStatus = "ok" | "degraded" | "down" | "unknown";

interface BackendState {
  status: BackendStatus;
  details: HealthResponse | null;
}

const POLL_MS = 60_000;

async function probe(): Promise<BackendState> {
  try {
    const details = await apiClient.health();
    return { status: details.status, details };
  } catch {
    return { status: "down", details: null };
  }
}

/**
 * OfflineBanner — dua lapis status koneksi:
 * 1. `navigator.onLine` (device offline) → amber banner.
 * 2. Backend health (CockroachDB/OpenRouter/S3) → pill status di pojok.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => (typeof navigator === "undefined" ? false : !navigator.onLine));
  const [backend, setBackend] = useState<BackendState>({ status: "unknown", details: null });

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const state = await probe();
      if (!cancelled) setBackend(state);
    };
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const label =
    backend.status === "ok"
      ? `Backend ok`
      : backend.status === "degraded"
        ? `Backend degraded`
        : backend.status === "down"
          ? "Backend offline"
          : "Checking backend…";

  const pillColor =
    backend.status === "ok"
      ? "bg-emerald-500 text-white"
      : backend.status === "degraded"
        ? "bg-amber-500 text-ink"
        : backend.status === "down"
          ? "bg-rose-500 text-white"
          : "bg-ink/70 text-white/70";

  return (
    <>
      {offline && (
        <div className="fixed inset-x-0 top-0 z-[90] bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-ink">
          Offline — camera, mic, and vault stay on this device. Network features will retry when you reconnect.
        </div>
      )}
      {!offline && (
        <div className="pointer-events-none fixed bottom-3 right-3 z-[85]">
          <button
            type="button"
            onClick={() => void (async () => setBackend(await probe()))()}
            title={backend.details ? `CRDB ${backend.details.crdb} · LLM ${backend.details.llm} · S3 ${backend.details.s3}` : "Backend status"}
            className={cn(
              "pointer-events-auto rounded-full px-3 py-1 text-[11px] font-semibold shadow-[var(--shadow-float)] transition-colors",
              pillColor,
            )}
          >
            {label}
          </button>
        </div>
      )}
    </>
  );
}
