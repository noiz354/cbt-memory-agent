import { describe, expect, it } from "vitest";
import { attachmentViewElement, resolveAttachmentSource } from "./attachmentMedia";
import type { ChatAttachment } from "../types";

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: "a1",
    kind: "video",
    name: "rec.webm",
    sizeLabel: "1.5 MB",
    ...overrides,
  };
}

describe("resolveAttachmentSource", () => {
  it("uses the live blob URL when a previewUrl (local object URL) is present", () => {
    const src = resolveAttachmentSource(attachment({ previewUrl: "blob:http://x/1" }));
    expect(src).toEqual({ type: "blob", url: "blob:http://x/1" });
  });

  it("prefers the live blob URL even when a mediaId is also set", () => {
    const src = resolveAttachmentSource(
      attachment({ mediaId: "node-1", previewUrl: "blob:http://x/1" }),
    );
    expect(src.type).toBe("blob");
  });

  it("falls back to persisted backend media for image/video/audio with a mediaId", () => {
    const src = resolveAttachmentSource(attachment({ mediaId: "node-1" }));
    expect(src).toEqual({ type: "persisted", mediaId: "node-1" });
  });

  it("is unavailable for pdf/txt with no previewUrl (live-only kinds, not in DB)", () => {
    expect(resolveAttachmentSource(attachment({ kind: "pdf" }))).toEqual({ type: "unavailable" });
    expect(resolveAttachmentSource(attachment({ kind: "txt" }))).toEqual({ type: "unavailable" });
  });

  it("is unavailable when there is neither a blob URL nor a mediaId", () => {
    expect(resolveAttachmentSource(attachment())).toEqual({ type: "unavailable" });
  });
});

describe("attachmentViewElement", () => {
  it("maps each kind to the matching HTML render element", () => {
    expect(attachmentViewElement("video")).toBe("video");
    expect(attachmentViewElement("audio")).toBe("audio");
    expect(attachmentViewElement("image")).toBe("img");
    expect(attachmentViewElement("pdf")).toBe("iframe");
    expect(attachmentViewElement("txt")).toBe("pre");
  });
});
