/**
 * Reflection skills injection — baca SKILL.md CockroachDB yang di-vendor
 * (Addition B) dan bangun satu blok konteks untuk prompt LLM reflection.
 *
 * File dicari di dua lokasi:
 *   - dev/test : `<repo>/skills/cockroachdb-skills/skills/<rel>` (via __dirname)
 *   - bundled  : `/var/task/skills/cockroachdb-skills/skills/<rel>` (Lambda zip)
 *
 * `SKILLS_DIR` env (test-only) mengganti root repo skills untuk menguji
 * graceful degradation. Semua file hilang → `{ content:'', names:[] }` —
 * TIDAK pernah melempar.
 */

import { readFile } from "fs/promises";
import * as path from "path";
import { logger } from "./logger";

export interface ReflectionSkills {
  content: string;
  names: string[];
}

export const SKILL_MAX_CHARS = 500;

const SKILL_FILES = [
  {
    name: "cockroachdb-sql",
    rel: "cockroachdb-query-and-schema-design/cockroachdb-sql/SKILL.md",
  },
  {
    name: "profiling-statement-fingerprints",
    rel: "cockroachdb-observability-and-diagnostics/profiling-statement-fingerprints/SKILL.md",
  },
];

function skillCandidates(rel: string): string[] {
  const skillsRoot =
    process.env.SKILLS_DIR ??
    path.join(__dirname, "../../skills/cockroachdb-skills/skills");
  const bundledRoot = path.join(__dirname, "skills/cockroachdb-skills/skills");
  return [path.join(skillsRoot, rel), path.join(bundledRoot, rel)];
}

async function readFirstExisting(rel: string): Promise<string | null> {
  for (const candidate of skillCandidates(rel)) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // lanjut ke kandidat berikutnya (dev vs bundled)
    }
  }
  return null;
}

/**
 * Baca semua SKILL.md yang dikonfigurasi, truncate ke SKILL_MAX_CHARS, dan
 * susun blok prompt. File hilang → dilewati; semua hilang → konten kosong.
 */
export async function loadReflectionSkills(): Promise<ReflectionSkills> {
  const loaded: { name: string; content: string }[] = [];

  for (const skill of SKILL_FILES) {
    const text = await readFirstExisting(skill.rel);
    if (text === null) {
      logger.warn("reflection.skills_failed", "Reflection skill file not found", { name: skill.name });
      continue;
    }
    loaded.push({ name: skill.name, content: text.slice(0, SKILL_MAX_CHARS) });
  }

  if (loaded.length === 0) return { content: "", names: [] };

  const block = `--- CockroachDB Agent Skills Context ---\n\n${loaded
    .map((s) => `${s.name}: ${s.content}`)
    .join("\n\n--- ")}`;

  return { content: block, names: loaded.map((s) => s.name) };
}
