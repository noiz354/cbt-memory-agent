import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const auth = vi.hoisted(() => ({ getAuthHeaders: vi.fn() }));
const api = vi.hoisted(() => ({
  presignMedia: vi.fn(),
  uploadMediaToS3: vi.fn(),
  createAttachment: vi.fn(),
}));

vi.mock("@/shared/lib/authSession", () => ({ getAuthHeaders: auth.getAuthHeaders }));
vi.mock("@/shared/lib/apiClient", () => ({ apiClient: api }));

import { indexAttachment } from "@/features/chat/lib/attachmentIndex";

const PRESIGNED = {
  v: 1 as const,
  key: "media/usr-1/abc.jpg",
  action: "https://s3.example/post",
  fields: { key: "media/usr-1/abc.jpg", "x-amz-algorithm": "AWS4-HMAC-SHA256" },
};

describe("indexAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getAuthHeaders.mockReturnValue({ token: "tok-1", deviceId: "dev-1" });
    api.presignMedia.mockResolvedValue(PRESIGNED);
    api.uploadMediaToS3.mockResolvedValue(undefined);
    api.createAttachment.mockResolvedValue({ v: 1, ok: true, nodeId: "n-1", attachmentId: "a-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("presign → upload → create, returns nodeId", async () => {
    const blob = new Blob(["data"], { type: "image/jpeg" });
    const result = await indexAttachment({
      kind: "image",
      blob,
      mimeType: "image/jpeg",
      ext: "jpg",
      analysis: { emotions: { primary: "sad", confidence: 0.82 } },
      embeddedNarrative: "User appeared sad",
      title: "Camera · sad 82%",
      confidence: 0.82,
    });

    expect(result).toEqual({ nodeId: "n-1", attachmentId: "a-1" });
    expect(api.presignMedia).toHaveBeenCalledWith(
      { v: 1, kind: "image", ext: "jpg", mimeType: "image/jpeg" },
      "tok-1",
      "dev-1",
    );
    expect(api.uploadMediaToS3).toHaveBeenCalledWith(PRESIGNED, blob);
    expect(api.createAttachment).toHaveBeenCalledWith(
      {
        v: 1,
        attachment: {
          kind: "image",
          analysis: { emotions: { primary: "sad", confidence: 0.82 } },
          embeddedNarrative: "User appeared sad",
          s3Key: "media/usr-1/abc.jpg",
          title: "Camera · sad 82%",
          confidence: 0.82,
          mimeType: "image/jpeg",
          sizeBytes: blob.size,
          durationMs: undefined,
          frameCount: undefined,
          sessionId: undefined,
          turnId: undefined,
        },
      },
      "tok-1",
      "dev-1",
    );
  });

  it("throws when not authenticated, before any network call", async () => {
    auth.getAuthHeaders.mockReturnValue(null);
    await expect(
      indexAttachment({
        kind: "audio",
        blob: new Blob([]),
        mimeType: "audio/webm",
        analysis: {},
        embeddedNarrative: "x",
        title: "Voice note",
      }),
    ).rejects.toThrow("Not authenticated.");
    expect(api.presignMedia).not.toHaveBeenCalled();
    expect(api.uploadMediaToS3).not.toHaveBeenCalled();
    expect(api.createAttachment).not.toHaveBeenCalled();
  });

  it("propagates S3 upload failure", async () => {
    api.uploadMediaToS3.mockRejectedValue(new Error("S3 upload 403: Forbidden"));
    await expect(
      indexAttachment({
        kind: "video",
        blob: new Blob([]),
        mimeType: "video/webm",
        analysis: { timeline: [] },
        embeddedNarrative: "x",
        title: "Video",
        durationMs: 45000,
      }),
    ).rejects.toThrow("S3 upload 403");
    expect(api.createAttachment).not.toHaveBeenCalled();
  });

  it("propagates create failure (no silent node)", async () => {
    api.createAttachment.mockRejectedValue(new Error("boom"));
    await expect(
      indexAttachment({
        kind: "image",
        blob: new Blob([]),
        mimeType: "image/jpeg",
        analysis: {},
        embeddedNarrative: "x",
        title: "Img",
      }),
    ).rejects.toThrow("boom");
  });
});
