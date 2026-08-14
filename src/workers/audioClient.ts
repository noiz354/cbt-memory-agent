import type { AudioWorkerOut } from "./audio.worker";
import { getAudioProcessorUrl } from "./audio-processor";

interface VadResult {
  type: "voice";
  probability: number;
  isVoice: boolean;
  ts: number;
}

let worker: Worker | null = null;
let vadWorker: Worker | null = null;
let context: AudioContext | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let workletNode: AudioWorkletNode | null = null;
let useWorklet = true;

// Fallback: ScriptProcessorNode (deprecated but still functional)
let processor: ScriptProcessorNode | null = null;

// VAD state
let vadEnabled = true;
let voiceActive = false;
let silenceFrames = 0;

/**
 * Try AudioWorklet first; fallback to ScriptProcessorNode if unsupported.
 *
 * VAD (Voice Activity Detection) runs in parallel:
 * - When VAD says "no voice" → PCM is discarded (saves CPU for transcription)
 * - When VAD says "voice" → PCM forwarded to analysis worker
 * - After SILENCE_FLUSH_FRAMES of silence → flush buffer signal
 *
 * Important: we do NOT connect to destination (context.destination).
 * This prevents echo/speaker feedback when only analysis is needed.
 */
export async function startAudioWorker(
  stream: MediaStream,
  onLevel: (rms: number, peak: number) => void,
  onVoice?: (isVoice: boolean, probability: number) => void,
) {
  stopAudioWorker();

  // Start VAD worker
  vadWorker = new Worker(new URL("./vad.worker.ts", import.meta.url), { type: "module" });
  vadWorker.onmessage = (event: MessageEvent<VadResult>) => {
    if (event.data.type !== "voice") return;
    voiceActive = event.data.isVoice;
    onVoice?.(event.data.isVoice, event.data.probability);

    if (!event.data.isVoice) {
      silenceFrames++;
    } else {
      silenceFrames = 0;
    }
  };

  // Start analysis worker (RMS/peak level meter)
  worker = new Worker(new URL("./audio.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<AudioWorkerOut>) => {
    if (event.data.type === "level") onLevel(event.data.rms, event.data.peak);
  };

  context = new AudioContext();
  source = context.createMediaStreamSource(stream);

  if (useWorklet && context.audioWorklet) {
    try {
      // Register the worklet processor via inline blob URL
      const workletUrl = getAudioProcessorUrl();
      await context.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      workletNode = new AudioWorkletNode(context, "analysis-processor");
      workletNode.port.onmessage = (event) => {
        if (event.data.type !== "pcm") return;
        const samples = event.data.samples as Float32Array;

        // VAD gate: only forward PCM when voice is detected or VAD is disabled
        if (!vadEnabled) {
          worker?.postMessage({ type: "pcm", samples });
          return;
        }

        // Send to VAD for detection
        vadWorker?.postMessage(
          { type: "pcm", samples, sampleRate: context!.sampleRate },
          [samples.buffer],
        );

        // Always forward to level meter (waveform visual still works)
        worker?.postMessage({ type: "pcm", samples });
      };

      // Analysis only — no destination connection
      source.connect(workletNode);
      return;
    } catch {
      // Worklet failed — fall through to ScriptProcessor
      useWorklet = false;
    }
  }

  // Fallback: ScriptProcessorNode (deprecated but works everywhere)
  processor = context.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    worker?.postMessage({ type: "pcm", samples });
  };
  source.connect(processor);
  // Intentionally NOT: processor.connect(context.destination) — prevents echo
}

export function stopAudioWorker() {
  workletNode?.disconnect();
  processor?.disconnect();
  source?.disconnect();
  void context?.close();
  workletNode = null;
  processor = null;
  source = null;
  context = null;
  worker?.terminate();
  worker = null;
  vadWorker?.terminate();
  vadWorker = null;
  voiceActive = false;
  silenceFrames = 0;
}

/** Check if voice is currently active (for gating transcription). */
export function isVoiceActive(): boolean {
  return voiceActive;
}

/** Enable or disable VAD gating. */
export function setVadEnabled(enabled: boolean) {
  vadEnabled = enabled;
}

/** Get silence frame count (for flush detection). */
export function getSilenceFrames(): number {
  return silenceFrames;
}
