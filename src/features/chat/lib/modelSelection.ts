/**
 * Model preference selection for the composer picker.
 *
 * The user's chosen provider+model is persisted to localStorage and used as the
 * FIRST attempt in the LLM fallback chain. Because providers/models can be
 * removed from the registry over time, all stored preferences are validated
 * against the registry before being applied — stale/missing entries fall back
 * to the app default chain.
 */

import {
  getModel,
  getProvider,
  type LLMProviderId,
} from "@/shared/lib/llmRegistry";

export interface PreferredModel {
  providerId: LLMProviderId;
  modelId: string;
}

const STORAGE_KEY = "cbt-preferred-model";

/**
 * Short, human-friendly label for the model chip on an assistant reply.
 * e.g. local-webllm → "on-device", openrouter/gpt-4o-mini → "openrouter".
 */
export function formatModelLabel(providerId: string | undefined, modelId: string | undefined): string {
  if (!providerId) return "model";
  if (providerId === "local-webllm") return "on-device";
  if (providerId === "backend-proxy") return "backend";
  if (providerId === "openrouter") {
    const base = modelId?.split("/").pop() ?? "openrouter";
    return base;
  }
  const provider = getProvider(providerId as LLMProviderId);
  return provider?.name ?? providerId;
}

export function isValidModel(pref: PreferredModel | null): pref is PreferredModel {
  if (!pref) return false;
  if (!getProvider(pref.providerId)) return false;
  return Boolean(getModel(pref.providerId, pref.modelId));
}

export interface ResolvedModel {
  providerId: LLMProviderId;
  modelId: string;
}

/**
 * Return the validated stored preference, or the given fallback when the
 * preference is missing/invalid. Never returns an invalid model.
 */
export function resolvePreferred(
  preferred: PreferredModel | null,
  fallback: ResolvedModel,
): ResolvedModel {
  if (isValidModel(preferred)) {
    return { providerId: preferred.providerId, modelId: preferred.modelId };
  }
  return fallback;
}

export function readPreferredModel(): PreferredModel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreferredModel;
    return isValidModel(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePreferredModel(pref: PreferredModel | null): void {
  try {
    if (pref) localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode) — preference simply isn't persisted
  }
}
