/**
 * Prosody DSP — on-device, dijalankan di worker (OfflineAudioContext decode).
 * Fungsi murni `computeProsody` sengaja dipisahkan dari glue worker agar bisa
 * di-test langsung (vitest, environment node).
 *
 * Mengukur: energy (RMS), pitch rata-rata (autocorrelation), pitch variance,
 * pause ratio (ambang silence), dan speech rate (bila wordCount diberikan).
 */

import type { ProsodyFeatures } from "./emotionMapping";

export interface ProsodyOptions {
  wordCount?: number;
}

const FRAME_MS = 20;
const SILENCE_RMS = 0.02;
const PITCH_MIN_HZ = 60;
const PITCH_MAX_HZ = 400;

export function computeProsody(
  samples: Float32Array,
  sampleRate: number,
  options: ProsodyOptions = {},
): ProsodyFeatures {
  const frameLen = Math.max(1, Math.floor((sampleRate * FRAME_MS) / 1000));
  const frameCount = Math.max(1, Math.floor(samples.length / frameLen));

  const rmsPerFrame: number[] = [];
  const pitchPerFrame: number[] = [];
  let voicedMs = 0;

  for (let f = 0; f < frameCount; f++) {
    const start = f * frameLen;
    const frame = samples.subarray(start, start + frameLen);

    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    rmsPerFrame.push(rms);

    if (rms >= SILENCE_RMS) {
      voicedMs += FRAME_MS;
      const pitch = estimatePitch(frame, sampleRate);
      if (pitch) pitchPerFrame.push(pitch);
    }
  }

  const voicedRatio = frameCount === 0 ? 0 : voicedMs / (frameCount * FRAME_MS);
  const totalMs = (samples.length / sampleRate) * 1000;
  const pauseRatio = totalMs === 0 ? 0 : clamp01(1 - voicedRatio);

  const energy = rmsPerFrame.length === 0 ? 0 : average(rmsPerFrame);
  const avgPitch = pitchPerFrame.length === 0 ? 0 : average(pitchPerFrame);
  const pitchVariance = pitchPerFrame.length === 0 ? 0 : variance(pitchPerFrame, avgPitch);

  const speakingMs = totalMs * (1 - pauseRatio);
  const speechRateWpm =
    options.wordCount && speakingMs > 0 ? Math.round((options.wordCount / speakingMs) * 60000) : 0;

  return {
    avgPitch: Math.round(avgPitch),
    pitchVariance: Math.round(pitchVariance),
    speechRateWpm,
    pauseRatio: round2(pauseRatio),
    energy: round2(energy),
  };
}

/** Pitch estimator sederhana (autocorrelation) — tidak dipakai untuk nada musik. */
function estimatePitch(frame: Float32Array, sampleRate: number): number | null {
  const n = frame.length;
  const minLag = Math.max(2, Math.floor(sampleRate / PITCH_MAX_HZ));
  const maxLag = Math.min(n, Math.floor(sampleRate / PITCH_MIN_HZ));

  // Hitung korelasi untuk tiap lag; cari lag dengan korelasi maksimum.
  const corrs: { lag: number; corr: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n - lag; i++) {
      num += frame[i] * frame[i + lag];
      den += frame[i] * frame[i];
    }
    const corr = den === 0 ? 0 : num / den;
    corrs.push({ lag, corr });
  }

  let best = { lag: -1, corr: 0 };
  for (const c of corrs) {
    if (c.corr > best.corr) best = c;
  }
  if (best.lag <= 0 || best.corr < 0.3) return null;

  // Periode fundamental = lag terkecil yang korelasinya ≥ 85% puncak
  // (hindari memilih harmonik/kelipatan periode untuk nada murni).
  const threshold = best.corr * 0.85;
  const fundamental = corrs.find((c) => c.corr >= threshold);
  const lag = fundamental?.lag ?? best.lag;
  return sampleRate / lag;
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[], mean: number): number {
  return values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
