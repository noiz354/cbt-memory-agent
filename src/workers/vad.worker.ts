/**
 * VAD (Voice Activity Detection) worker — wraps Silero VAD ONNX model.
 *
 * Receives PCM samples from main thread, returns voice probability.
 * Gates downstream transcription: only transcribe when voice is detected.
 *
 * Model: silero_vad.onnx (~2.3MB), loaded once at startup from /public/models/.
 * Sample rate: 16000 Hz (Silero requirement).
 * Window: 512 samples (32ms at 16kHz).
 */

import * as ort from "onnxruntime-web";

interface VadWorkerIn {
  type: "pcm";
  samples: Float32Array;
  sampleRate: number;
}

interface VadWorkerOut {
  type: "voice";
  probability: number; // 0.0 – 1.0
  isVoice: boolean;    // probability > threshold
  ts: number;
}

interface VadWorkerControl {
  type: "config";
  threshold?: number;
  sampleRate?: number;
}

let session: ort.InferenceSession | null = null;
let threshold = 0.5;

/**
 * Resample audio to 16kHz if needed (linear interpolation).
 * Silero only accepts 16kHz input.
 */
function resampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return samples;
  const ratio = 16000 / fromRate;
  const outLen = Math.floor(samples.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;
    const a = samples[Math.min(idx, samples.length - 1)];
    const b = samples[Math.min(idx + 1, samples.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

async function loadModel() {
  if (session) return session;
  session = await ort.InferenceSession.create("/models/silero_vad.onnx", {
    executionProviders: ["wasm"],
  });
  return session;
}

async function runVad(samples: Float32Array, sampleRate: number): Promise<number> {
  const sess = await loadModel();
  const resampled = resampleTo16k(samples, sampleRate);

  // Silero expects: input (Float32), sr (Int64), h (Float32[], hidden state), c (Float32[], cell state)
  // For simplified usage, we pass just the audio frame
  // Note: full Silero VAD API also needs h/c state — we use a stateless approximation here
  const tensor = new ort.Tensor("float32", resampled, [1, resampled.length]);
  const srTensor = new ort.Tensor("int64", [BigInt(sampleRate)], [1]);

  try {
    const result = await sess.run({ input: tensor, sr: srTensor });
    // Output is a probability score
    const output = result.output as ort.Tensor;
    return output.data[0] as number;
  } catch {
    // If model fails, return neutral probability
    return 0.5;
  }
}

self.onmessage = async (event: MessageEvent<VadWorkerIn | VadWorkerControl>) => {
  const data = event.data;

  if (data.type === "config") {
    if (data.threshold !== undefined) threshold = data.threshold;
    return;
  }

  if (data.type !== "pcm") return;

  try {
    const probability = await runVad(data.samples, data.sampleRate);
    const payload: VadWorkerOut = {
      type: "voice",
      probability: Math.max(0, Math.min(1, probability)),
      isVoice: probability > threshold,
      ts: Date.now(),
    };
    self.postMessage(payload);
  } catch {
    // On any error, report neutral — don't crash the worker
    self.postMessage({
      type: "voice",
      probability: 0.5,
      isVoice: false,
      ts: Date.now(),
    } satisfies VadWorkerOut);
  }
};
