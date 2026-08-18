import { describe, expect, it } from "vitest";
import { TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";

describe("telemetry events catalog (frontend)", () => {
  it("mirrors backend-catalog failure events for observability", () => {
    expect(TELEMETRY_EVENTS).toMatchObject({
      transcriptFailed: "transcript_failed",
      attachmentFailed: "attachment_failed",
    });
  });

  it("keeps voice success events alongside their failure counterparts", () => {
    expect(TELEMETRY_EVENTS.voiceNoteRecorded).toBe("voice_note_recorded");
    expect(TELEMETRY_EVENTS.transcriptReceived).toBe("transcript_received");
    expect(TELEMETRY_EVENTS.transcriptFailed).toBe("transcript_failed");
    expect(TELEMETRY_EVENTS.attachmentFailed).toBe("attachment_failed");
  });
});