import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPipeline = vi.hoisted(() => vi.fn());

vi.mock("@huggingface/transformers", () => ({
  pipeline: mockPipeline,
  env: { allowLocalModels: false },
}));

const model = vi.fn();

async function loadWorker() {
  vi.resetModules();
  return import("@/workers/transcribe.worker");
}

beforeEach(() => {
  mockPipeline.mockReset();
  model.mockReset();
  mockPipeline.mockResolvedValue(model);
});

describe("transcribe worker", () => {
  it("preloads the model once via warmupTranscriber (idle warm-up)", async () => {
    const { warmupTranscriber } = await loadWorker();
    await warmupTranscriber();
    expect(mockPipeline).toHaveBeenCalledOnce();
    await warmupTranscriber();
    expect(mockPipeline).toHaveBeenCalledOnce();
  });

  it("loads the quantized-safe fp32 weights (quantized ONNX fails in ort-web)", async () => {
    const { warmupTranscriber } = await loadWorker();
    await warmupTranscriber();
    expect(mockPipeline.mock.calls[0][0]).toBe("automatic-speech-recognition");
    expect(mockPipeline.mock.calls[0][1]).toBe("onnx-community/whisper-tiny");
    expect(mockPipeline.mock.calls[0][2]).toMatchObject({ dtype: "fp32" });
  });

  it("warm-up failure is non-fatal", async () => {
    mockPipeline.mockRejectedValue(new Error("net down"));
    const { warmupTranscriber } = await loadWorker();
    await expect(warmupTranscriber()).resolves.toBeUndefined();
  });

  it("returns trimmed text on success with language hint", async () => {
    model.mockResolvedValue({ text: "  hai, apa kabar?  " });
    const { handleTranscribe } = await loadWorker();
    const out = await handleTranscribe({ type: "transcribe", blobUrl: "blob:1", language: "id" });
    expect(out).toMatchObject({ ok: true, text: "hai, apa kabar?" });
    expect(model).toHaveBeenCalledWith("blob:1", expect.objectContaining({ language: "id" }));
  });

  it("passes a decoded Float32Array through to the model (16kHz mono)", async () => {
    model.mockResolvedValue({ text: "halo" });
    const { handleTranscribe } = await loadWorker();
    const pcm = new Float32Array([0.1, -0.2, 0.3]);
    const out = await handleTranscribe({ type: "transcribe", blobUrl: "blob:1", audio: pcm, language: "en" });
    expect(out.ok).toBe(true);
    // Pipeline menerima Float32Array (bukan string/URL) + language hint.
    expect(model).toHaveBeenCalledWith(pcm, expect.objectContaining({ language: "en" }));
  });

  it("reports model-load failures with stage and message", async () => {
    mockPipeline.mockRejectedValue(new Error("model 404"));
    const { handleTranscribe } = await loadWorker();
    const out = await handleTranscribe({ type: "transcribe", blobUrl: "blob:1" });
    expect(out.ok).toBe(false);
    expect(out.stage).toBe("model-load");
    expect(out.error).toBe("model 404");
  });

  it("reports inference failures with stage and message", async () => {
    const { handleTranscribe } = await loadWorker();
    model.mockRejectedValue(new Error("wasm oom"));
    const out = await handleTranscribe({ type: "transcribe", blobUrl: "blob:1" });
    expect(out.ok).toBe(false);
    expect(out.stage).toBe("inference");
    expect(out.error).toBe("wasm oom");
  });

  it("reports empty transcript as decode-stage failure (not success)", async () => {
    model.mockResolvedValue({ text: "   " });
    const { handleTranscribe } = await loadWorker();
    const out = await handleTranscribe({ type: "transcribe", blobUrl: "blob:1" });
    expect(out.ok).toBe(false);
    expect(out.stage).toBe("decode");
    expect(out.error).toBe("empty transcript");
  });
});