import { attachmentKindLabel, formatAttachmentTime } from "@/features/memory/lib/attachmentFormat";
import type { AttachmentKind } from "@/shared/lib/apiClient";
import { describe, expect, it } from "vitest";

describe("attachmentKindLabel", () => {
  it("labels each media kind", () => {
    expect(attachmentKindLabel("image")).toBe("Image");
    expect(attachmentKindLabel("video")).toBe("Video");
    expect(attachmentKindLabel("audio")).toBe("Voice note");
  });

  it("exhaustively covers all AttachmentKind values", () => {
    const kinds: AttachmentKind[] = ["image", "video", "audio"];
    for (const k of kinds) {
      expect(attachmentKindLabel(k).length).toBeGreaterThan(0);
    }
  });
});

describe("formatAttachmentTime", () => {
  it("returns em dash for missing/invalid timestamps", () => {
    expect(formatAttachmentTime()).toBe("—");
    expect(formatAttachmentTime("not-a-date")).toBe("—");
  });

  it("formats a valid ISO timestamp into day · time", () => {
    const out = formatAttachmentTime("2026-08-16T09:30:00.000Z");
    expect(out).toContain("·");
  });
});
