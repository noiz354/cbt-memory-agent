/**
 * Unit tests — master prompt loader.
 *
 * - `loadMasterPrompt` membaca `prompts/klinik-psikolog.md` dari repo (dev/test)
 *   atau dari bundle (`/var/task/prompts/...`).
 * - File hilang → fallback ke prompt lama (tidak pernah melempar).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as mod from "../lib/promptLoader";

// Reset cache modul-level antar test supaya tiap test benar-benar memuat ulang.
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete process.env.PROMPTS_DIR;
});

describe("loadMasterPrompt", () => {
  it("memuat prompt dari file (via PROMPTS_DIR)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "prompts-"));
    try {
      await writeFile(path.join(dir, "klinik-psikolog.md"), "Kamu adalah klinik psikolog.", "utf8");
      process.env.PROMPTS_DIR = dir;

      const fresh = await import("../lib/promptLoader");
      const prompt = await fresh.loadMasterPrompt();
      expect(prompt).toContain("Kamu adalah klinik psikolog.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fallback ke prompt lama saat file tidak ada", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "prompts-empty-"));
    try {
      process.env.PROMPTS_DIR = dir; // kosong
      const fresh = await import("../lib/promptLoader");
      const prompt = await fresh.loadMasterPrompt();
      expect(prompt).toContain("supportive CBT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("memuat prompt asli dari repo (tanpa PROMPTS_DIR)", async () => {
    const prompt = await mod.loadMasterPrompt();
    expect(prompt.length).toBeGreaterThan(0);
    // Prompt baru harus memuat identitas klinik psikolog.
    expect(prompt.toLowerCase()).toContain("klinik");
  });
});
