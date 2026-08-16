import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzeFrame, stopAnalyzeWorker } from "@/workers/faceClient";

function makeFrame(): ImageData {
  return {
    data: new Uint8ClampedArray(4 * 64 * 48),
    width: 64,
    height: 48,
  } as ImageData;
}

describe("faceClient.analyzeFrame", () => {
  let instances: FakeWorker[];
  let signal: unknown;

  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    posted: unknown[] = [];
    terminated = false;
    constructor(_url: unknown, _opts: unknown) {
      instances.push(this);
    }
    postMessage(message: unknown) {
      this.posted.push(message);
      if (signal) {
        queueMicrotask(() => this.onmessage?.({ data: signal }));
      }
    }
    terminate() {
      this.terminated = true;
    }
  }

  beforeEach(() => {
    instances = [];
    signal = {
      type: "signal",
      expression: "sad",
      confidence: 0.75,
      updatedAt: 1234,
      model: "mediapipe",
    };
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    stopAnalyzeWorker();
    vi.unstubAllGlobals();
  });

  it("posts an analyze frame with a copied buffer and resolves the signal", async () => {
    const frame = makeFrame();
    const original = frame.data.buffer;

    const promise = analyzeFrame(frame);
    const worker = instances[0];

    const posted = worker.posted[0] as {
      type: string;
      width: number;
      height: number;
      buffer: ArrayBuffer;
    };
    expect(posted.type).toBe("analyze");
    expect(posted.width).toBe(64);
    expect(posted.height).toBe(48);
    // Buffer is copied, not the caller's buffer (caller may reuse the canvas).
    expect(posted.buffer).not.toBe(original);

    const resolved = await promise;
    expect(resolved.expression).toBe("sad");
    expect(resolved.confidence).toBe(0.75);
    expect(resolved.model).toBe("mediapipe");
  });

  it("reuses one warm worker for successive frames", async () => {
    const frame = makeFrame();
    const p1 = analyzeFrame(frame);
    const p2 = analyzeFrame(frame);

    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toEqual(s2);
    expect(instances.length).toBe(1);
    expect(instances[0].posted.length).toBe(2);
  });

  it("terminate rejects in-flight frames", async () => {
    const frame = makeFrame();
    const p1 = analyzeFrame(frame);
    stopAnalyzeWorker();
    await expect(p1).rejects.toThrow("Face analyzer terminated.");
    expect(instances[0].terminated).toBe(true);
  });
});
