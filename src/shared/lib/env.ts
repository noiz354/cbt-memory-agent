/**
 * Environment detection — membedakan deployment hosted (CloudFront) vs lokal.
 *
 * Digunakan oleh Privacy → LLM panel untuk menampilkan mode jujur:
 * di hosted deployment, on-device (WebLLM) dan BYOK tidak bisa bekerja karena
 * header CSP produksi (`connect-src 'self' blob:`) memblokir unduhan model dari
 * huggingface.co serta panggilan langsung ke provider API eksternal (lihat
 * nginx.conf + infa/modules/frontend/main.tf). Provider aktif hanya backend-proxy
 * (same-origin `/api/v1/chat/turn`).
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** True untuk hostname lokal (loopback) — Vite dev / self-host di mesin sendiri. */
export function isLocalHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * True saat app disajikan dari deployment hosted (bukan loopback).
 * Aman dipanggil saat `window` tidak tersedia (SSR/test) → false.
 */
export function isHostedDeployment(): boolean {
  if (typeof window === "undefined") return false;
  return !isLocalHostname(window.location.hostname);
}