import { describe, it, expect } from "vitest";
import {
  ApiError,
  ERROR_CODES,
  classifyFetchError,
  errorMessage,
  errorCode,
  errorLabel,
} from "@/shared/lib/errors";

describe("ApiError", () => {
  it("derives retriable from code suffix by default", () => {
    expect(new ApiError(ERROR_CODES.network_unreachable, "x").retriable).toBe(true);
    expect(new ApiError(ERROR_CODES.media_upload_failed, "x").retriable).toBe(true);
    expect(new ApiError(ERROR_CODES.not_found, "x").retriable).toBe(false);
  });

  it("stores code, httpStatus, and original cause", () => {
    const cause = new Error("boom");
    const err = new ApiError(ERROR_CODES.media_upload_failed, "upload failed", {
      httpStatus: 403,
      original: cause,
    });
    expect(err.code).toBe("media.upload_failed");
    expect(err.httpStatus).toBe(403);
    expect(err.original).toBe(cause);
  });
});

describe("classifyFetchError", () => {
  it("passes through ApiError unchanged", () => {
    const e = new ApiError(ERROR_CODES.media_save_failed, "save failed");
    expect(classifyFetchError(e)).toBe(e);
  });

  it("classifies TypeError 'Failed to fetch' as network unreachable (CORS/CSP)", () => {
    const err = classifyFetchError(new TypeError("Failed to fetch"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(ERROR_CODES.network_unreachable);
    expect(err.retriable).toBe(true);
    expect(err.message).toContain("CORS");
  });

  it("classifies AbortError as request aborted", () => {
    const err = classifyFetchError(new DOMException("Aborted", "AbortError"));
    expect(err.code).toBe(ERROR_CODES.request_aborted);
  });

  it("classifies backend SSE error frame", () => {
    const frame = new Error("Terjadi kendala teknis. Coba lagi dalam beberapa saat.");
    frame.name = "BackendErrorFrame";
    const err = classifyFetchError(frame);
    expect(err.code).toBe(ERROR_CODES.chat_turn_failed);
  });

  it("classifies RateLimitError as retriable internal", () => {
    const rl = new Error("Rate limit reached (429)");
    rl.name = "RateLimitError";
    const err = classifyFetchError(rl);
    expect(err.code).toBe(ERROR_CODES.internal);
    expect(err.retriable).toBe(true);
  });

  it("falls back to internal for unknown errors, keeping message", () => {
    const err = classifyFetchError(new Error("some other failure"));
    expect(err.code).toBe(ERROR_CODES.internal);
    expect(err.message).toBe("some other failure");
  });
});

describe("errorMessage / errorCode / errorLabel", () => {
  it("returns Error.message for Error instances", () => {
    expect(errorMessage(new Error("m1"))).toBe("m1");
    expect(errorMessage("raw string")).toBe("raw string");
    expect(errorMessage(42)).toContain("Terjadi kendala teknis");
  });

  it("errorCode maps ApiError code and falls back to internal", () => {
    expect(errorCode(new ApiError(ERROR_CODES.db_unavailable, "x"))).toBe("dependency.db_unavailable");
    expect(errorCode(new Error("plain"))).toBe("internal.unhandled");
  });

  it("errorLabel renders a title-cased full code", () => {
    expect(errorLabel(ERROR_CODES.network_unreachable)).toBe("Network Unreachable");
    expect(errorLabel(ERROR_CODES.chat_turn_failed)).toBe("Chat Turn Failed");
    expect(errorLabel(ERROR_CODES.internal)).toBe("Internal Unhandled");
  });
});