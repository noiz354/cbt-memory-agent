/**
 * On-device audio analysis worker. Uses transferred PCM frames only.
 * No raw audio is posted back to the main thread.
 */

export interface AudioWorkerIn {
  type: "pcm";
  samples: Float32Array;
}

export interface AudioWorkerOut {
  type: "level";
  rms: number;
  peak: number;
}

self.onmessage = (event: MessageEvent<AudioWorkerIn>) => {
  if (event.data.type !== "pcm") return;
  const samples = event.data.samples;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i]);
    sum += v * v;
    if (v > peak) peak = v;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  const payload: AudioWorkerOut = { type: "level", rms, peak };
  self.postMessage(payload);
};
