/**
 * Probe jalur upload media (S3) dari sisi browser.
 *
 * Badge "Backend ok" (OfflineBanner) hanya mengecek /health — yang menguji
 * CRDB/LLM/S3 dari DALAM Lambda (server-side). Jalur "Analyze & save" justru
 * PUT langsung ke S3 dari browser (cross-origin, butuh CORS bucket). Probe ini
 * menguji apakah browser BENAR-BENAR bisa menjangkau host S3; kegagalan
 * TypeError 'Failed to fetch' menandakan preflight CORS/CSP/network diblokir.
 */

export const MEDIA_UPLOAD_HOST =
  import.meta.env.VITE_MEDIA_UPLOAD_HOST ??
  "https://cbt-memory-exports.s3.ap-southeast-3.amazonaws.com";

export interface MediaUploadProbeResult {
  reachable: boolean;
  reason?: "cors_blocked" | "network_error";
  status?: number;
}

/**
 * GET cross-origin ke root bucket S3. Anonim selalu 403 (tanpa ListBucket),
 * TAPI S3 menempelkan header CORS pada error response bila origin cocok —
 * jadi jika CORS bucket benar, fetch resolve (reachable). Jika CORS/CSP
 * memblokir, browser melempar TypeError 'Failed to fetch'.
 */
export async function probeMediaUploadReachability(
  url: string = MEDIA_UPLOAD_HOST,
): Promise<MediaUploadProbeResult> {
  try {
    const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
    return { reachable: true, status: res.status };
  } catch (err) {
    if (err instanceof TypeError) return { reachable: false, reason: "cors_blocked" };
    return { reachable: false, reason: "network_error" };
  }
}

export type HealthStatus = "ok" | "degraded" | "down";

export interface CombinedStatus {
  status: HealthStatus;
  detail: string | null;
}

/** Gabungkan hasil probe /health (server-side) dengan probe jalur upload (client-side). */
export function combineBackendStatus(
  health: HealthStatus,
  probe: MediaUploadProbeResult,
): CombinedStatus {
  if (health === "down") return { status: "down", detail: null };
  if (health === "degraded") return { status: "degraded", detail: null };
  if (!probe.reachable) {
    return {
      status: "degraded",
      detail: "Media upload diblokir di browser (CORS/CSP/network) — periksa CORS bucket S3.",
    };
  }
  return { status: "ok", detail: null };
}