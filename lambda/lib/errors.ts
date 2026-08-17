/**
 * Error Standardization — single taxonomy + envelope + single choke point.
 *
 * Semua error bisnis melewati modul ini. Setiap kegagalan:
 *   - PUNYA kode stabil (machine-readable, queryable di Loki/CloudWatch).
 *   - Dikategorikan (client/validation/dependency/internal) → menentukan
 *     statusCode, apakah retriable, dan level log (warn vs error).
 *   - Dienkapsulasi dalam envelope JSON yang sama untuk SEMUA respon:
 *       { error: { code, message, retriable } }
 *   - Di-report TEPAT SATU KALI via reportError() → logger + metric + span.
 *
 * Frontend memakai payload yang sama untuk klasifikasi (ApiError).
 * Hubungan dengan health: client/validation errors TIDAK menaikkan status
 * alarm infra; dependency/internal errors memicu app.error.count + span ERROR.
 *
 * Aturan (security-and-hardening): message user-facing TIDAK pernah memuat
 * detail internal/cause; details hanya untuk log, tidak untuk response.
 */

import type { Span } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import { logger } from "./logger";
import { emitLog, recordError } from "./telemetry";

export type ErrorCategory = "client" | "validation" | "dependency" | "internal";
export type ErrorLevel = "warn" | "error";

export interface ErrorCodeDef {
  /** HTTP status yang dikirim ke client. */
  statusCode: number;
  /** client=kesalahan pemanggil, validation=400-an, dependency=layanan eksternal, internal=bug tak dikenal. */
  category: ErrorCategory;
  /** layak dicoba ulang otomatis (retry/bounce)? */
  retriable: boolean;
  /** `warn` untuk kesalahan yang diharapkan/handled, `error` untuk kegagalan tak terduga. */
  level: ErrorLevel;
  /** Pesan user-facing default (tidak pernah berisi cause/internal). */
  message: string;
}

/**
 * Katalog kode error — SATU-SATUNYA sumber kebenaran. Cardinality metric
 * `app.error.count` dibatasi oleh set ini; jangan menambah kode ad-hoc.
 */
export const ERROR_CODES: Record<string, ErrorCodeDef> = {
  // ── auth ──────────────────────────────────────────────────────────────
  "auth.missing_token": {
    statusCode: 401, category: "client", retriable: false, level: "warn",
    message: "Missing Authorization header",
  },
  "auth.missing_device": {
    statusCode: 401, category: "client", retriable: false, level: "warn",
    message: "Missing X-Device-Id header",
  },
  "auth.invalid_token": {
    statusCode: 401, category: "client", retriable: false, level: "warn",
    message: "Invalid or malformed authorization token",
  },
  "auth.magic_link_failed": {
    statusCode: 500, category: "internal", retriable: false, level: "error",
    message: "Failed to create magic link",
  },
  "auth.resend_failed": {
    statusCode: 502, category: "dependency", retriable: true, level: "error",
    message: "Email delivery unavailable",
  },
  "auth.callback_failed": {
    statusCode: 500, category: "internal", retriable: false, level: "error",
    message: "Failed to consume magic link",
  },

  // ── validation ────────────────────────────────────────────────────────
  "validation.invalid_json": {
    statusCode: 400, category: "validation", retriable: false, level: "warn",
    message: "Invalid JSON body",
  },
  "validation.invalid_request": {
    statusCode: 400, category: "validation", retriable: false, level: "warn",
    message: "Invalid request",
  },
  "validation.payload_too_large": {
    statusCode: 413, category: "client", retriable: false, level: "warn",
    message: "Payload too large",
  },

  // ── resource / routing ────────────────────────────────────────────────
  "resource.not_found": {
    statusCode: 404, category: "client", retriable: false, level: "warn",
    message: "Not found",
  },
  "resource.misconfigured": {
    statusCode: 501, category: "internal", retriable: false, level: "error",
    message: "Service misconfigured",
  },

  // ── dependency (external services) ────────────────────────────────────
  "dependency.db_unavailable": {
    statusCode: 503, category: "dependency", retriable: true, level: "error",
    message: "Service temporarily unavailable",
  },
  "dependency.llm_unavailable": {
    statusCode: 503, category: "dependency", retriable: true, level: "error",
    message: "AI service temporarily unavailable",
  },
  "dependency.s3_unavailable": {
    statusCode: 503, category: "dependency", retriable: true, level: "error",
    message: "Storage service temporarily unavailable",
  },
  "dependency.telemetry_unavailable": {
    statusCode: 502, category: "dependency", retriable: true, level: "error",
    message: "Telemetry service unavailable",
  },

  // ── media (attachments) ───────────────────────────────────────────────
  "media.presign_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to prepare upload",
  },
  "media.upload_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Media upload failed",
  },
  "media.save_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to save media",
  },
  "media.list_failed": {
    statusCode: 500, category: "internal", retriable: false, level: "error",
    message: "Failed to load media",
  },
  "media.delete_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to delete media",
  },
  "media.not_found": {
    statusCode: 404, category: "client", retriable: false, level: "warn",
    message: "Media not found",
  },

  // ── chat ──────────────────────────────────────────────────────────────
  "chat.turn_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Terjadi kendala teknis. Coba lagi dalam beberapa saat.",
  },

  // ── memory / sessions / misc ──────────────────────────────────────────
  "memory.list_failed": {
    statusCode: 500, category: "internal", retriable: false, level: "error",
    message: "Failed to load memories",
  },
  "memory.upsert_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to save memory",
  },
  "memory.delete_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to delete memory",
  },
  "memory.edge_delete_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to delete memory link",
  },
  "session.save_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to save session",
  },
  "session.list_failed": {
    statusCode: 500, category: "internal", retriable: false, level: "error",
    message: "Failed to load sessions",
  },
  "turns.list_failed": {
    statusCode: 500, category: "internal", retriable: false, level: "error",
    message: "Failed to load turns",
  },
  "semantic.search_failed": {
    statusCode: 500, category: "internal", retriable: false, level: "error",
    message: "Search temporarily unavailable",
  },
  "events.track_failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to record event",
  },
  "export.failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to export data",
  },
  "purge.failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Failed to purge data",
  },
  "reflection.failed": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Background job failed",
  },

  // ── fallback terakhir ─────────────────────────────────────────────────
  "internal.unhandled": {
    statusCode: 500, category: "internal", retriable: true, level: "error",
    message: "Internal server error",
  },
};

export type ErrorCode = keyof typeof ERROR_CODES;

export interface AppErrorOptions {
  /** Override pesan user-facing default dari katalog. */
  message?: string;
  /** Cause asli (di-log, TIDAK pernah dikirim ke client). */
  cause?: unknown;
  /** Detail tambahan untuk log/monitoring (bukan untuk response). */
  details?: Record<string, string | number | boolean | null>;
}

/**
 * Error domain aplikasi. Selalu memiliki kode katalog + kategori + status.
 * Handler tidak pernah membuat Error polos; semua gagal melalui AppError.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly category: ErrorCategory;
  readonly retriable: boolean;
  readonly level: ErrorLevel;
  readonly details?: Record<string, string | number | boolean | null>;

  constructor(code: ErrorCode, opts: AppErrorOptions = {}) {
    const def = ERROR_CODES[code];
    super(opts.message ?? def.message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = def.statusCode;
    this.category = def.category;
    this.retriable = def.retriable;
    this.level = def.level;
    if (opts.details) this.details = opts.details;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/** Factory singkat — `throw fail("resource.not_found")`. */
export function fail(code: ErrorCode, opts: AppErrorOptions = {}): AppError {
  return new AppError(code, opts);
}

/** True jika error sudah berupa AppError terstandardisasi. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Ekstrak pesan internal yang aman untuk log (bukan untuk response). */
export function causeMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/** Normalisasi error tak dikenal → AppError (fallback internal.unhandled). */
export function classifyError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("internal.unhandled", {
    cause: err instanceof Error ? err : new Error(causeMessage(err)),
  });
}

/**
 * Envelope standar untuk BODY response error.
 * Hanya code/message/retriable yang boleh keluar — details & cause TIDAK.
 */
export function errorEnvelope(
  err: AppError,
): { error: { code: ErrorCode; message: string; retriable: boolean } } {
  return {
    error: { code: err.code, message: err.message, retriable: err.retriable },
  };
}

export interface ReportErrorContext {
  /** Root/active span; status ERROR + exception dicatat di sini. */
  span?: Span;
  /** Route normalisasi (label/monitoring — bukan query string). */
  route?: string;
}

/**
 * SINGLE CHOKE POINT pelaporan error. Semua kegagalan (handler bisnis, catch
 * sentral, chatTurn SSE, reflection cron) wajib lewat sini sehingga:
 *   - logger JSON (→ CloudWatch + Loki) TEPAT SATU KALI
 *   - OTLP log record (→ Loki di Grafana Cloud)
 *   - `app.error.count` metric (→ Mimir/Prometheus)
 *   - span status ERROR + exception ter-record (→ Tempo)
 *
 * Menghasilkan AppError terklasifikasi (untuk envelope/statusCode).
 */
export function reportError(err: unknown, ctx: ReportErrorContext = {}): AppError {
  const appErr = classifyError(err);

  const fields: Record<string, string | number | boolean> = {
    code: appErr.code,
    category: appErr.category,
    status: appErr.statusCode,
    retriable: appErr.retriable,
  };
  if (ctx.route) fields.route = ctx.route;
  const cause = appErr.cause;
  if (cause instanceof Error) fields.cause = cause.message;

  logger.error(appErr.code, appErr.message, fields);
  emitLog(15, `[${appErr.code}] ${appErr.message}`, fields);
  recordError(appErr.code, appErr.category, appErr.statusCode);

  if (ctx.span) {
    const exception = appErr.cause instanceof Error ? appErr.cause : appErr;
    ctx.span.recordException(exception);
    ctx.span.setStatus({ code: SpanStatusCode.ERROR, message: appErr.code });
  }
  return appErr;
}