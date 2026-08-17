/**
 * Frontend error classification — cermin kontrak error backend
 * (`lambda/lib/errors.ts`). Mengubah error mentah (TypeError 'Failed to fetch',
 * pesan API mentah, frame SSE error) menjadi error ber-`code` yang bisa
 * ditampilkan konsisten di UI dan dicari di observability.
 *
 * Backend selalu mengirim envelope `{ error: { code, message, retriable } }`.
 * Frontend memetakan error apa pun (network/CORS/CSP, HTTP status, BackendErrorFrame,
 * RateLimitError) ke bentuk yang sama sehingga toast/UI tidak pernah menampilkan
 * pesan mentah seperti 'Failed to fetch'.
 */

/** Kode error yang dijamin backend kirim (subset katalog lambda/lib/errors.ts). */
export const ERROR_CODES = {
  auth_missing: "auth.missing_token",
  auth_invalid: "auth.invalid_token",
  validation_invalid_json: "validation.invalid_json",
  validation_invalid_request: "validation.invalid_request",
  not_found: "resource.not_found",
  misconfigured: "resource.misconfigured",
  db_unavailable: "dependency.db_unavailable",
  llm_unavailable: "dependency.llm_unavailable",
  s3_unavailable: "dependency.s3_unavailable",
  telemetry_unavailable: "dependency.telemetry_unavailable",
  media_presign_failed: "media.presign_failed",
  media_upload_failed: "media.upload_failed",
  media_save_failed: "media.save_failed",
  media_not_found: "media.not_found",
  chat_turn_failed: "chat.turn_failed",
  memory_list_failed: "memory.list_failed",
  session_save_failed: "session.save_failed",
  export_failed: "export.failed",
  purge_failed: "purge.failed",
  internal: "internal.unhandled",
  // Kode yang TIDAK datang dari backend — diklasifikasikan di sisi browser:
  network_unreachable: "network.unreachable",
  request_aborted: "network.request_aborted",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Error terklasifikasi dengan envelope konsisten untuk UI. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly retriable: boolean;
  readonly httpStatus?: number;
  readonly original: unknown;

  constructor(code: ErrorCode, message: string, opts: { retriable?: boolean; httpStatus?: number; original?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retriable = opts.retriable ?? (code.endsWith("unavailable") || code.endsWith("unreachable") || code.endsWith("_failed"));
    this.httpStatus = opts.httpStatus;
    this.original = opts.original;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (err as { name?: string })?.name === "ApiError";
}

/** Ekstrak pesan user-facing dari error apa pun. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return "Terjadi kendala teknis. Coba lagi dalam beberapa saat.";
}

/** Kode displayable untuk ditampilkan di UI/support (code asli dari backend). */
export function errorCode(err: unknown): ErrorCode {
  if (isApiError(err)) return err.code;
  if (isRateLimit(err)) return ERROR_CODES.internal;
  return ERROR_CODES.internal;
}

function isRateLimit(err: unknown): boolean {
  return (err as { name?: string })?.name === "RateLimitError";
}

/** Nama kode pendek (full dot-path → spasi, title-case) untuk tag UI/dukungan. */
export function errorLabel(code: ErrorCode): string {
  return code.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Klasifikasi fetch error:
 *  - TypeError 'Failed to fetch' → network.unreachable (CORS/CSP/offline)
 *  - AbortError → network.request_aborted
 *  - Backend SSE error frame → kode dari frame (chat.turn_failed dll)
 *  - RateLimitError → dipertahankan
 *  - HTTP Response tanpa parsing → network.unreachable (tidak bisa dibedakan)
 */
export function classifyFetchError(err: unknown): ApiError {
  if (isApiError(err)) return err;
  if (isRateLimit(err)) {
    return new ApiError(ERROR_CODES.internal, errorMessage(err), { retriable: true, original: err });
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return new ApiError(ERROR_CODES.request_aborted, "Permintaan dibatalkan.", { original: err });
  }
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return new ApiError(
      ERROR_CODES.network_unreachable,
      "Tidak dapat terhubung ke server. Periksa koneksi (CORS/CSP dapat memblokir).",
      { retriable: true, original: err },
    );
  }
  if (err instanceof Error && err.name === "BackendErrorFrame") {
    return new ApiError(ERROR_CODES.chat_turn_failed, errorMessage(err), { retriable: true, original: err });
  }
  return new ApiError(ERROR_CODES.internal, errorMessage(err), { retriable: true, original: err });
}