/**
 * Master prompt loader — baca `prompts/klinik-psikolog.md` dari repo (dev/test)
 * atau dari bundle Lambda (`/var/task/prompts/...`), lalu bangun SYSTEM_PROMPT
 * untuk chat handler.
 *
 * File hilang → fallback ke prompt lama (TIDAK pernah melempar), supaya handler
 * tetap jalan walau file tidak ikut ter-bundle.
 */

import { readFile } from "fs/promises";
import * as path from "path";
import { logger } from "./logger";

export const PROMPT_MAX_CHARS = 6000;

const FALLBACK_PROMPT = `You are a supportive CBT (Cognitive-Behavioral Therapy) assistant.
Follow these guardrails:
- Respond with warmth, curiosity, and evidence-based CBT techniques (cognitive restructuring, Socratic questioning, behavioral activation).
- Use the user's stored memory context below to personalize responses. Do NOT invent memories that are not provided.
- NEVER store or echo personal identifying details (real names, phone numbers, addresses, passwords).
- If the user expresses thoughts of self-harm or suicide, respond with immediate empathy and urge them to contact local crisis services (in Indonesia: 119, or emergency 112).
- Keep responses concise (under ~250 words) and end with one gentle, actionable question.
- If there is no memory context, acknowledge the user warmly and ask how they are feeling.`;

function promptCandidates(): string[] {
  const repoRoot =
    process.env.PROMPTS_DIR ?? path.join(__dirname, "../../prompts");
  const bundledRoot = path.join(__dirname, "prompts");
  return [path.join(repoRoot, "klinik-psikolog.md"), path.join(bundledRoot, "klinik-psikolog.md")];
}

async function readFirstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // lanjut ke kandidat berikutnya (dev vs bundled)
    }
  }
  return null;
}

/**
 * Muat master prompt. Hasil di-cache per proses (Lambda container reuse).
 * File hilang → fallback ke FALLBACK_PROMPT + log warning.
 */
let cached: string | null = null;

export async function loadMasterPrompt(): Promise<string> {
  if (cached !== null) return cached;

  const text = await readFirstExisting(promptCandidates());
  if (text === null) {
    logger.warn("prompt.load_failed", "Master prompt file not found — using fallback prompt");
    cached = FALLBACK_PROMPT;
    return cached;
  }

  cached = text.trim().slice(0, PROMPT_MAX_CHARS);
  return cached;
}
