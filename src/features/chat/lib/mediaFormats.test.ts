import { describe, it, expect } from "vitest";
import { extFromMimeType, timelineStops } from "@/features/chat/lib/mediaFormats";

describe("extFromMimeType", () => {
  it("derives webm for the default audio/webm container", () => {
    expect(extFromMimeType("audio/webm")).toBe("webm");
  });

  it("maps iOS/MP4 audio to m4a (not hardcoded webm)", () => {
    expect(extFromMimeType("audio/mp4")).toBe("m4a");
    expect(extFromMimeType("audio/x-m4a")).toBe("m4a");
  });

  it("maps video mp4/quicktime based on container", () => {
    expect(extFromMimeType("video/mp4")).toBe("mp4");
    expect(extFromMimeType("video/quicktime")).toBe("mov");
    expect(extFromMimeType("video/webm")).toBe("webm");
  });

  it("maps image types", () => {
    expect(extFromMimeType("image/jpeg")).toBe("jpg");
    expect(extFromMimeType("image/png")).toBe("png");
    expect(extFromMimeType("image/webp")).toBe("webp");
  });

  it("falls back for unknown containers", () => {
    expect(extFromMimeType("")).toBe("bin");
    expect(extFromMimeType("application/octet-stream")).toBe("bin");
  });
});

describe("timelineStops", () => {
  it("samples at least one frame even when duration is unknown (0)", () => {
    expect(timelineStops(0, 5000)).toEqual([0]);
    expect(timelineStops(1000, 5000)).toEqual([0]);
  });

  it("walks the recording in steps, staying below the clip length", () => {
    expect(timelineStops(15000, 5000)).toEqual([0, 5000, 10000]);
  });

  it("never samples at or beyond the clip length", () => {
    const stops = timelineStops(12000, 5000);
    expect(stops).toEqual([0, 5000, 10000]);
    expect(stops.every((t) => t >= 0 && t < 12000)).toBe(true);
  });
});