/**
 * trackEvent — frontend event tracker helper (FASE 4).
 *
 * Helper ringan, fire-and-forget: buffer events, flush ke POST /api/v1/events
 * saat batch penuh (50) / interval 10s / pagehide. TIDAK memblokir UX.
 *
 * Allowlist event diverifikasi di BACKEND (ALLOWED_MONETIZATION_EVENTS);
 * frontend hanya mengirim nama — event non-allowlist di-drop server.
 * Tidak ada UI billing di frontend; ini murni instrumentation.
 */

import { apiClient } from "./apiClient";
import { getAuthHeaders } from "./authSession";

export interface TrackEventInput {
  name: string;
  properties?: Record<string, unknown> | null;
  sessionId?: string;
  occurredAt?: string;
}

const MAX_BATCH = 50;
const FLUSH_MS = 10_000;

let buffer: TrackEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function scheduleFlush(): void {
  if (timer || flushing) return;
  timer = setTimeout(() => void flush(), FLUSH_MS);
}

/** Kirim batch pending (exported untuk testing / manual flush). */
export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (flushing || buffer.length === 0) return;

  const batch = buffer.splice(0, MAX_BATCH);
  flushing = true;
  try {
    const auth = getAuthHeaders();
    if (!auth) return; // belum ada identitas — drop diam-diam
    await apiClient.trackEvent(batch, auth.token, auth.deviceId);
  } catch {
    // best-effort: gagal dikirim → drop (analytics tidak boleh blokir UX)
  } finally {
    flushing = false;
    if (buffer.length > 0) scheduleFlush();
  }
}

/** Enqueue satu event tracking. */
export function trackEvent(input: TrackEventInput): void {
  buffer.push(input);
  scheduleFlush();
}

/** Flush sisa buffer saat halaman ditutup (keepalive best-effort). */
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flush());
}
