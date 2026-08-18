/**
 * Unit tests — audioClient VAD lifecycle.
 *
 * Membuktikan VAD (Silero ONNX ~2.3MB + inferensi tiap PCM frame) hanya
 * dijalankan bila ada konsumen `onVoice`; tanpa konsumen, PCM diteruskan
 * langsung ke level meter tanpa spawn VAD worker maupun kirim ke VAD.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startAudioWorker, stopAudioWorker, isVoiceActive, getSilenceFrames } from "@/workers/audioClient";

type WorkerInstance = {
  url: string;
  onmessage: ((e: { data: Record<string, unknown> }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted(() => {
  const workers: WorkerInstance[] = [];
  const FakeWorker = class {
    url: string;
    onmessage: ((e: { data: Record<string, unknown> }) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor(url: URL | string) {
      this.url = typeof url === "string" ? url : url.href;
      workers.push(this);
    }
  };
  return { workers, FakeWorker };
});

const mockPort = () => {
  let handler: ((e: { data: Record<string, unknown> }) => void) | null = null;
  return {
    set onmessage(fn: ((e: { data: Record<string, unknown> }) => void) | null) {
      handler = fn;
    },
    get onmessage() {
      return handler;
    },
    postMessage: vi.fn(),
    fire(data: Record<string, unknown>) {
      handler?.({ data });
    },
  };
};

function stubBrowserGlobals(): ReturnType<typeof mockPort> {
  const port = mockPort();
  vi.stubGlobal("Worker", state.FakeWorker);
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 48000;
      audioWorklet = { addModule: vi.fn(async () => undefined) };
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
      close = vi.fn(async () => undefined);
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = port;
      disconnect = vi.fn();
    },
  );
  return port;
}

beforeEach(() => {
  state.workers.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  stopAudioWorker();
  vi.unstubAllGlobals();
});

const PCM: Float32Array = () => new Float32Array([0.1, -0.2, 0.3]);
const stream = {} as MediaStream;

describe("startAudioWorker — VAD gating", () => {
  it("does NOT create the VAD worker when there is no onVoice consumer", async () => {
    const port = stubBrowserGlobals();
    await startAudioWorker(stream, vi.fn());

    const vadWorkers = state.workers.filter((w) => w.url.includes("vad.worker"));
    expect(vadWorkers.length).toBe(0);

    // PCM forward langsung ke level meter tanpa hambatan VAD.
    const level = state.workers.find((w) => w.url.includes("audio.worker"))!;
    port.fire({ type: "pcm", samples: PCM() });
    expect(level.postMessage).toHaveBeenCalledWith({ type: "pcm", samples: expect.any(Float32Array) });
  });

  it("creates the VAD worker and routes PCM through it when onVoice is provided", async () => {
    const port = stubBrowserGlobals();
    const onVoice = vi.fn();
    await startAudioWorker(stream, vi.fn(), onVoice);

    const vadWorkers = state.workers.filter((w) => w.url.includes("vad.worker"));
    expect(vadWorkers.length).toBe(1);

    // Simulate a PCM frame — must reach the VAD worker (with sampleRate + transfer).
    const level = state.workers.find((w) => w.url.includes("audio.worker"))!;
    port.fire({ type: "pcm", samples: PCM() });
    const vad = vadWorkers[0];
    expect(vad.postMessage).toHaveBeenCalledWith(
      { type: "pcm", samples: expect.any(Float32Array), sampleRate: 48000 },
      [expect.any(ArrayBuffer)],
    );
    expect(level.postMessage).toHaveBeenCalledWith({ type: "pcm", samples: expect.any(Float32Array) });

    // VAD verdict → onVoice consumer notified + voiceActive set.
    vad.onmessage?.({ data: { type: "voice", isVoice: true, probability: 0.9, ts: 1 } });
    expect(onVoice).toHaveBeenCalledWith(true, 0.9);
    expect(isVoiceActive()).toBe(true);
    expect(getSilenceFrames()).toBe(0);
  });

  it("counts silence frames from VAD verdicts when a consumer exists", async () => {
    const port = stubBrowserGlobals();
    await startAudioWorker(stream, vi.fn(), vi.fn());

    const vad = state.workers.find((w) => w.url.includes("vad.worker"))!;
    vad.onmessage?.({ data: { type: "voice", isVoice: false, probability: 0.1, ts: 1 } });
    expect(isVoiceActive()).toBe(false);
    expect(getSilenceFrames()).toBe(1);
  });

  it("non-VAD events from the worklet are ignored", async () => {
    const port = stubBrowserGlobals();
    await startAudioWorker(stream, vi.fn());

    const level = state.workers.find((w) => w.url.includes("audio.worker"))!;
    port.fire({ type: "level" });
    expect(level.postMessage).not.toHaveBeenCalled();
  });
});