/**
 * Unit test — error standardization core (taxonomy, envelope, choke point).
 *
 * Validasi:
 *   1. AppError mengambil code/status/category/retriable/level dari katalog.
 *   2. Envelope hanya mengekspos { code, message, retriable } — details/cause
 *      TIDAK pernah bocor ke client.
 *   3. classifyError menormalkan error tak dikenal → internal.unhandled.
 *   4. reportError (single choke point) memanggil logger + emitLog + recordError
 *      + menandai span ERROR — tepat satu kali.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { AppError, classifyError, errorEnvelope, fail, isAppError, reportError } from "../lib/errors";
import * as telemetry from "../lib/telemetry";

function captureStdout(fn: () => void): string {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write");
  spy.mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return writes.join("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppError taxonomy", () => {
  it("derives code, statusCode, category, retriable, level from the catalog", () => {
    const err = new AppError("chat.turn_failed");
    expect(err.name).toBe("AppError");
    expect(err.code).toBe("chat.turn_failed");
    expect(err.statusCode).toBe(500);
    expect(err.category).toBe("internal");
    expect(err.retriable).toBe(true);
    expect(err.level).toBe("error");
    expect(err.message).toBe("Terjadi kendala teknis. Coba lagi dalam beberapa saat.");
  });

  it("allows a user-facing message override without touching internals", () => {
    const err = new AppError("validation.invalid_request", { message: "title is required" });
    expect(err.code).toBe("validation.invalid_request");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("title is required");
  });

  it("keeps cause and details on the error (for logs, not for the response)", () => {
    const cause = new Error("connection refused");
    const err = new AppError("media.save_failed", { cause, details: { nodeId: "abc-123", retries: 3 } });
    expect(err.cause).toBe(cause);
    expect(err.details).toEqual({ nodeId: "abc-123", retries: 3 });
  });

  it("fail() factory builds an AppError", () => {
    const err = fail("resource.not_found");
    expect(isAppError(err)).toBe(true);
    expect(err.code).toBe("resource.not_found");
    expect(err.statusCode).toBe(404);
  });

  it("isAppError distinguishes AppError from plain Error", () => {
    expect(isAppError(new AppError("auth.invalid_token"))).toBe(true);
    expect(isAppError(new Error("boom"))).toBe(false);
  });
});

describe("classifyError", () => {
  it("passes through an existing AppError unchanged", () => {
    const original = new AppError("dependency.llm_unavailable");
    expect(classifyError(original)).toBe(original);
  });

  it("normalizes a plain Error to internal.unhandled with cause preserved", () => {
    const appErr = classifyError(new Error("TSQuery crash"));
    expect(appErr).toBeInstanceOf(AppError);
    expect(appErr.code).toBe("internal.unhandled");
    expect(appErr.statusCode).toBe(500);
    expect(appErr.cause).toBeInstanceOf(Error);
    expect((appErr.cause as Error).message).toBe("TSQuery crash");
  });

  it("normalizes a thrown string to internal.unhandled", () => {
    const appErr = classifyError("boom");
    expect(appErr.code).toBe("internal.unhandled");
    expect((appErr.cause as Error).message).toBe("boom");
  });
});

describe("errorEnvelope", () => {
  it("exposes ONLY code, message, retriable to the client", () => {
    const err = new AppError("media.save_failed", {
      cause: new Error("s3 500"),
      details: { s3Key: "media/u/1.jpg", nodeId: "abc" },
    });
    const body = JSON.parse(JSON.stringify(errorEnvelope(err)));
    expect(body).toEqual({
      error: { code: "media.save_failed", message: "Failed to save media", retriable: true },
    });
    // No leakage of internal details/cause.
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error).not.toHaveProperty("cause");
    expect(body.error).not.toHaveProperty("details");
    expect(body.error).not.toHaveProperty("statusCode");
    expect(body.error).not.toHaveProperty("category");
  });
});

describe("reportError (single choke point)", () => {
  it("logs one structured JSON line with code/category/status/retriable/route", () => {
    const out = captureStdout(() => {
      reportError(new AppError("media.presign_failed"), { route: "/api/v1/attachments/presign" });
    });
    const line = JSON.parse(out);
    expect(line.level).toBe("error");
    expect(line.code).toBe("media.presign_failed");
    expect(line.category).toBeDefined();
    expect(line.status).toBeDefined();
    expect(line.retriable).toBeDefined();
    expect(line.route).toBe("/api/v1/attachments/presign");
  });

  it("records the metric with code/category/statusClass labels (Mimir)", () => {
    const recordErrorSpy = vi.spyOn(telemetry, "recordError");
    reportError(new AppError("memory.delete_failed"));
    expect(recordErrorSpy).toHaveBeenCalledTimes(1);
    expect(recordErrorSpy).toHaveBeenCalledWith("memory.delete_failed", "internal", 500);
  });

  it("emits an OTLP log record (Loki)", () => {
    const emitLogSpy = vi.spyOn(telemetry, "emitLog");
    reportError(new AppError("auth.invalid_token"));
    expect(emitLogSpy).toHaveBeenCalledTimes(1);
    const [severity, body] = emitLogSpy.mock.calls[0];
    expect(severity).toBe(15); // SeverityNumber.ERROR
    expect(body).toContain("[auth.invalid_token]");
  });

  it("marks the span ERROR with the code as message (Tempo)", () => {
    const span = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
    };
    reportError(new Error("crash"), { span: span as never });
    expect(span.recordException).toHaveBeenCalledTimes(1);
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "internal.unhandled",
    });
  });

  it("returns the classified AppError (for envelope/statusCode)", () => {
    const appErr = reportError(new Error("db down"));
    expect(appErr).toBeInstanceOf(AppError);
    expect(appErr.code).toBe("internal.unhandled");
    expect(appErr.statusCode).toBe(500);
  });

  it("logs the cause message for diagnostics without exposing it to the client", () => {
    const out = captureStdout(() => {
      const appErr = reportError(new Error("connection refused"));
      expect(errorEnvelope(appErr).error.message).not.toContain("connection refused");
    });
    const line = JSON.parse(out);
    expect(line.cause).toBe("connection refused");
  });
});