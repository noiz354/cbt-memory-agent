/**
 * Unit tests — S3 client service (presigned media POST upload + object verification).
 *
 * mem-bukikan:
 * - presign media memakai presigned POST dengan condition content-length-range
 *   cap 25MB (S3 native) + Expires 900s, mengembalikan url+fields untuk klien.
 * - headMediaObject membedakan NotFound (exists:false) vs error lain (throw).
 * - ukuran object terbaca untuk cek konsistensi sizeBytes.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => {
  const sendMock = vi.fn();
  const createPresignedPostMock = vi.fn(() => ({
    url: "https://s3.example/post",
    fields: { key: "media/u/abc.webm", "x-amz-algorithm": "AWS4-HMAC-SHA256" },
  }));
  class FakeS3Client {
    send = sendMock;
  }
  return { sendMock, createPresignedPostMock, FakeS3Client };
});

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: hoisted.FakeS3Client };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://s3.example/get"),
}));
vi.mock("@aws-sdk/s3-presigned-post", () => ({
  createPresignedPost: hoisted.createPresignedPostMock,
}));
vi.mock("../lib/telemetry", () => ({ recordS3Operation: vi.fn(), recordMetric: vi.fn() }));

import { S3ClientService, MAX_MEDIA_UPLOAD_BYTES } from "../lib/s3";

describe("S3ClientService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("presignMediaPost caps the object at 25MB via content-length-range", async () => {
    const s3 = new S3ClientService("bucket-x");
    const post = await s3.presignMediaPost("media/u/abc.webm", "audio/webm");

    const input = hoisted.createPresignedPostMock.mock.calls[0][1];
    expect(input).toMatchObject({
      Bucket: "bucket-x",
      Key: "media/u/abc.webm",
      Expires: 900,
    });
    expect(input.Conditions).toEqual([["content-length-range", 1, MAX_MEDIA_UPLOAD_BYTES]]);
    expect(post.url).toBe("https://s3.example/post");
    expect(post.fields.key).toBe("media/u/abc.webm");
  });

  it("presignMediaPost is non-conditional on content type (client FormData decides)", async () => {
    const s3 = new S3ClientService("bucket-x");
    await s3.presignMediaPost("media/u/x.mp4", "video/mp4");
    const input = hoisted.createPresignedPostMock.mock.calls[0][1];
    expect(input.Conditions).toHaveLength(1);
    expect(input.Conditions[0]).toEqual(["content-length-range", 1, MAX_MEDIA_UPLOAD_BYTES]);
  });

  it("headMediaObject reports a missing object on S3 NotFound", async () => {
    hoisted.sendMock.mockRejectedValueOnce({ name: "NotFound" });
    const s3 = new S3ClientService("bucket-x");
    const head = await s3.headMediaObject("media/u/ghost.jpg");
    expect(head.exists).toBe(false);
    expect(hoisted.sendMock).toHaveBeenCalledTimes(1);
  });

  it("headMediaObject surfaces non-NotFound S3 errors", async () => {
    hoisted.sendMock.mockRejectedValueOnce(new Error("AccessDenied"));
    const s3 = new S3ClientService("bucket-x");
    await expect(s3.headMediaObject("media/u/x.jpg")).rejects.toThrow("AccessDenied");
  });

  it("headMediaObject returns the object size for consistency checks", async () => {
    hoisted.sendMock.mockResolvedValueOnce({ ContentLength: 2048 });
    const s3 = new S3ClientService("bucket-x");
    const head = await s3.headMediaObject("media/u/abc.jpg");
    expect(head.exists).toBe(true);
    expect(head.sizeBytes).toBe(2048);
  });
});