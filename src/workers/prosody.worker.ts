/**
 * On-device prosody analysis worker — pitch / energy / pause / speech rate.
 *
 * Menerima blob audio (blobUrl), decode via OfflineAudioContext, hitung
 * prosody dengan DSP murni (lib/prosody.ts), kirim hasil kembali.
 * Raw audio tidak pernah keluar dari worker.
 */

import { computeProsody } from "@/features/chat/lib/prosody";

interface ProsodyIn {
  type: "analyze";
  blobUrl: string;
  /** jumlah kata dari transcript (untuk speech rate); opsional */
  wordCount?: number;
}

interface ProsodyOut {
  type: "prosody";
  ok: boolean;
  result?: {
    avgPitch: number;
    pitchVariance: number;
    speechRateWpm: number;
    pauseRatio: number;
    energy: number;
  };
  durationMs?: number;
  error?: string;
}

async function decodeAudio(blobUrl: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const response = await fetch(blobUrl);
  const arrayBuffer = await response.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  return { samples: decoded.getChannelData(0), sampleRate: decoded.sampleRate };
}

self.onmessage = async (event: MessageEvent<ProsodyIn>) => {
  if (event.data.type !== "analyze") return;
  try {
    const { samples, sampleRate } = await decodeAudio(event.data.blobUrl);
    const result = computeProsody(samples, sampleRate, { wordCount: event.data.wordCount });
    const durationMs = Math.round((samples.length / sampleRate) * 1000);

    self.postMessage({ type: "prosody", ok: true, result, durationMs } satisfies ProsodyOut);
  } catch (err) {
    self.postMessage({
      type: "prosody",
      ok: false,
      error: err instanceof Error ? err.message : "prosody analysis failed",
    } satisfies ProsodyOut);
  }
};
