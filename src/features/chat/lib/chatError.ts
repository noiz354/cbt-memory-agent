/**
 * Pesan error yang ditampilkan pada bubble asisten ketika sendMessage gagal.
 * Memisahkan keputusan "pesan apa" dari chatStore agar bisa diuji terpisah.
 */

import { isRateLimitError } from "@/shared/lib/apiClient";
import { isQuotaExceededError } from "@/shared/lib/llmClient";

export const LLM_QUOTA_MESSAGE =
  "*— Kuota harian model gratis backend habis. Tambah credit akun OpenRouter atau pasang API key sendiri (Settings → LLM).*";

export const RATE_LIMIT_MESSAGE =
  "*— We're moving too fast. Rate limit hit — give it a minute, then try again.*";

export const ALL_FALLBACKS_FAILED_MESSAGE =
  "*— LLM unavailable. All providers failed (on-device, backend, and BYOK). Please try again later or configure an API key in Settings → LLM.*";

/**
 * Pilih pesan untuk bubble asisten saat percakapan gagal.
 * - Kuota backend habis (llm.quota_exhausted) → pesan kuota yang actionable.
 * - Rate limit 429 lokal → pesan rate limit.
 * - Selain itu (semua provider gagal) → pesan generik fallback.
 */
export function assistantErrorMessage(err: unknown): string {
  if (isQuotaExceededError(err)) return LLM_QUOTA_MESSAGE;
  if (isRateLimitError(err)) return RATE_LIMIT_MESSAGE;
  return ALL_FALLBACKS_FAILED_MESSAGE;
}

/**
 * True bila kegagalan punya pesan spesifik (kuota / rate limit) — bukan
 * kegagalan generik. Dipakai jalur resume agar pesan spesifik ditambahkan ke
 * konten yang sudah ter-stream; kegagalan generik cukup "*— resume failed —*".
 */
export function isSpecificLLMFailure(err: unknown): boolean {
  return isQuotaExceededError(err) || isRateLimitError(err);
}