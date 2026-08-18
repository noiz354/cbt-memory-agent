/**
 * Unit tests — decodeAudioTo16000 (main-thread audio decode for whisper).
 *
 * Whisper on-device menuntut Float32Array mono @16kHz; transformers.js tidak
 * me-resample Float32Array (load_audio gagal tanpa AudioContext, yang tidak ada
 * di Web Worker). Path decode resmi transformers.js load_audio adalah
 * AudioContext({sampleRate:16000}) + decodeAudioData (auto-resample) + downmix
 * stereo→mono (L+R)/√2. Helper ini menjalankan decode tsb di main thread.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeAudioTo16000 } from "./decodeAudio";

class MockCtx {
  sampleRate = 16000;
  decodeAudioData = vi.fn();
  close = vi.fn(async () => undefined);
}

function stubCtx(channels: Float32Array[]): MockCtx {
  const ctx = new MockCtx();
  ctx.decodeAudioData.mockResolvedValue({ length: channels[0].length, numberOfChannels: channels.length, getChannelData: (i: number) => channels[i] });
  vi.stubGlobal("AudioContext", class { sampleRate = 16000; decodeAudioData = ctx.decodeAudioData; close = ctx.close; });
  return ctx;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeAudioTo16000", () => {
  it("decodes a mono blob and returns the same mono samples", async () => {
    const mono = new Float32Array([0.1, -0.2, 0.3, 0.4]);
    const ctx = stubCtx([mono]);
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const out = await decodeAudioTo16000(blob);

    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(out).toEqual(mono);
  });

  it("downmixes stereo to mono using (L+R)/sqrt(2)", async () => {
    const left = new Float32Array([1, 0, -1]);
    const right = new Float32Array([1, 0, 1]);
    stubCtx([left, right]);
    const blob = new Blob([new Uint8Array([9])]);
    const out = await decodeAudioTo16000(blob);

    const s = Math.SQRT2;
    expect(out.length).toBe(3);
    expect(out[0]).toBeCloseTo((1 + 1) / s);
    expect(out[1]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo((-1 + 1) / s);
  });

  it("closes the AudioContext after decode to free resources", async () => {
    const ctx = stubCtx([new Float32Array([0.5])]);
    const blob = new Blob([new Uint8Array([0])]);
    await decodeAudioTo16000(blob);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("propagates decode errors (e.g. corrupt audio)", async () => {
    const ctx = new MockCtx();
    ctx.decodeAudioData.mockRejectedValue(new Error("decode failed"));
    vi.stubGlobal("AudioContext", class { sampleRate = 16000; decodeAudioData = ctx.decodeAudioData; close = ctx.close; });
    const blob = new Blob([new Uint8Array([0])]);
    await expect(decodeAudioTo16000(blob)).rejects.toThrow("decode failed");
  });
});