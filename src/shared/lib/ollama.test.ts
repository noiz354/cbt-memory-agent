/**
 * Unit tests — Ollama provider integration.
 *
 * `fetchOllamaModels`: list model dari /api/tags, mencoba beberapa kandidat
 *   base URL, tidak pernah melempar (ok:false saat semua gagal).
 * `ollamaChatModels`: filter model yang bisa dipakai chat (bukan embedding).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/shared/lib/llmRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/llmRegistry")>();
  return {
    ...actual,
  };
});

import {
  ollamaChatModels,
  ollamaBaseUrlCandidates,
} from "@/shared/lib/llmRegistry";

const { fetchOllamaModels } = await import("@/shared/lib/llmRegistry");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ollamaChatModels", () => {
  it("menyaring model embedding-only", () => {
    const models = [
      { name: "nomic-embed-text:latest", capabilities: ["embedding"] },
      { name: "llama3.1:latest", capabilities: ["completion", "tools"] },
      { name: "qwen3:4b", capabilities: ["completion", "tools", "thinking"] },
      { name: "minicpm-v:latest", capabilities: ["completion", "vision"] },
      { name: "mxbai-embed-large:latest", capabilities: ["embedding"] },
    ];
    const chat = ollamaChatModels(models);
    expect(chat.map((m) => m.name)).toEqual([
      "llama3.1:latest",
      "qwen3:4b",
      "minicpm-v:latest",
    ]);
  });

  it("memperlakukan model tanpa capabilities sebagai chat model", () => {
    const models = [{ name: "unknown-model:latest", capabilities: undefined }];
    expect(ollamaChatModels(models)).toHaveLength(1);
  });
});

describe("ollamaBaseUrlCandidates", () => {
  it("selalu berisi localhost:11434", () => {
    const candidates = ollamaBaseUrlCandidates();
    expect(candidates).toContain("http://localhost:11434");
  });
});

describe("fetchOllamaModels", () => {
  it("mengembalikan model saat localhost merespons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "llama3.1:latest", capabilities: ["completion"] }] }),
      }),
    );
    const res = await fetchOllamaModels();
    expect(res.ok).toBe(true);
    expect(res.models).toHaveLength(1);
    expect(res.models[0].name).toBe("llama3.1:latest");
  });

  it("mencoba kandidat kedua saat localhost menolak", async () => {
    // Simulasikan environment browser: location.hostname ada → kandidat kedua
    // (`<hostname>.local:11434`) ikut dicoba setelah localhost gagal.
    vi.stubGlobal("location", { hostname: "my-wsl" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // localhost gagal
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "qwen3:4b", capabilities: ["completion"] }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchOllamaModels();
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mengembalikan ok:false saat semua kandidat gagal (tidak melempar)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const res = await fetchOllamaModels();
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.models).toEqual([]);
  });
});
