/**
 * AudioWorklet processor — replaces deprecated ScriptProcessorNode.
 * Loaded as an inline blob URL so Vite doesn't bundle it as a module.
 * Runs in AudioWorkletGlobalScope — no imports allowed.
 */

const AUDIO_PROCESSOR_SOURCE = `
class AnalysisProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }
  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channelData = input[0];
    this.port.postMessage({ type: "pcm", samples: channelData }, [channelData.buffer]);
    return true;
  }
}
registerProcessor("analysis-processor", AnalysisProcessor);
`;

/** Create a Blob URL for the AudioWorklet module. */
export function getAudioProcessorUrl(): string {
  const blob = new Blob([AUDIO_PROCESSOR_SOURCE], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}
