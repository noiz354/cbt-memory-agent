/**
 * Unit tests — reflection skills injection (lambda/lib/agentSkills.ts).
 *
 * `loadReflectionSkills`: baca 2 SKILL.md vendored (cockroachdb-sql +
 * profiling-statement-fingerprints), truncate tiap skill ke SKILL_MAX_CHARS,
 * bangun satu blok prompt. Semua file hilang → `{ content:'', names:[] }`
 * (graceful). Tidak pernah melempar.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { loadReflectionSkills, SKILL_MAX_CHARS } from "../lib/agentSkills";

const SKILL_NAMES = ["cockroachdb-sql", "profiling-statement-fingerprints"];

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SKILLS_DIR;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SKILLS_DIR;
});

describe("loadReflectionSkills", () => {
  it("loads both vendored SKILL.md files and builds the context block", async () => {
    const res = await loadReflectionSkills();

    expect(res.names).toEqual(SKILL_NAMES);
    expect(res.content).toContain("CockroachDB Agent Skills Context");
    expect(res.content).toContain("cockroachdb-sql");
    expect(res.content).toContain("profiling-statement-fingerprints");
    // tiap skill di-truncate ke SKILL_MAX_CHARS → content jauh lebih pendek
    // dari gabungan file asli (117 + 329 baris).
    expect(res.content.length).toBeLessThan(1200);
  });

  it("truncates each skill body to SKILL_MAX_CHARS", async () => {
    const res = await loadReflectionSkills();
    const perSkill = res.content.split("\n\n--- ").slice(1);
    // Setiap segmen skill harus <= header + SKILL_MAX_CHARS + name
    for (const segment of perSkill) {
      expect(segment.length).toBeLessThan(SKILL_MAX_CHARS + 60);
    }
  });

  it("returns empty content when no skill files exist", async () => {
    process.env.SKILLS_DIR = "/nonexistent/skills-dir";
    const res = await loadReflectionSkills();
    expect(res.names).toEqual([]);
    expect(res.content).toBe("");
  });
});
