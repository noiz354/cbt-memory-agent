/**
 * decodeAudio — decode blob audio menjadi Float32Array mono @16kHz di main thread.
 *
 * Whisper on-device (transformers.js) butuh Float32Array mono @16kHz:
 * - `read_audio`/`load_audio` memakai AudioContext untuk decode URL string, yang
 *   TIDAK tersedia di Web Worker (error "Unable to load audio from path/URL
 *   since AudioContext is not available..." — terlihat live).
 * - `prepareAudios` mengembalikan Float32Array apa adanya TANPA resample, dan
 *   whisper feature extractor menghitung spectrogram pada sampling_rate 16000.
 *
 * Maka decode dilakukan di sini (main thread) mengikuti jalur resmi load_audio:
 * `new AudioContext({sampleRate:16000})` + `decodeAudioData` (auto-resample ke
 * 16kHz) + downmix stereo→mono (L+R)/√2. Hasilnya dikirim ke worker (transferable).
 */

const SCALING_FACTOR = Math.SQRT2;

export async function decodeAudioTo16000(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    return extractMono(audioBuffer);
  } finally {
    void context.close();
  }
}

function extractMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    out[i] = (SCALING_FACTOR * (left[i] + right[i])) / 2;
  }
  return out;
}
