/**
 * LLM Panel — Settings tab untuk kelola provider + API keys BYOK.
 *
 * Features:
 * - List 24 providers dengan model mereka
 * - Input API key (terenkripsi via IndexedDB + WebCrypto)
 * - Pilih model default untuk BYOK
 * - Test koneksi ke provider
 * - Revoke key per provider
 * - Fallback chain selector (on-device → backend → BYOK)
 */

import { PROVIDERS, type LLMProviderId } from "@/shared/lib/llmRegistry";
import { saveApiKey, getApiKey, revokeApiKey, listConfiguredProviders } from "@/shared/lib/byokKeyManager";
import { GlassPanel } from "@/shared/ui/GlassPanel";
import { cn } from "@/shared/lib/cn";
import { useState, useEffect, useCallback } from "react";
import { Key, Check, Loader2, Trash2, Zap } from "lucide-react";
import { toast } from "@/shared/store/toastStore";

interface ConfiguredState {
  providerId: LLMProviderId;
  modelId: string;
  hasKey: boolean;
  lastUsedAt: string | null;
}

export function LlmPanel() {
  const [configured, setConfigured] = useState<ConfiguredState[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderId>("openrouter");
  const [selectedModel, setSelectedModel] = useState("");
  const [inputKey, setInputKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const provider = PROVIDERS[selectedProvider];
  const models = provider.models;

  useEffect(() => {
    void loadConfigured();
  }, []);

  useEffect(() => {
    // Auto-select first model when provider changes
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].id);
    }
  }, [selectedProvider, models, selectedModel]);

  const loadConfigured = useCallback(async () => {
    const keys = await listConfiguredProviders();
    setConfigured(
      keys.map((k) => ({
        providerId: k.providerId,
        modelId: k.modelId,
        hasKey: true,
        lastUsedAt: k.lastUsedAt,
      })),
    );
  }, []);

  const handleSave = async () => {
    if (!inputKey.trim()) {
      toast("Key required", "Enter an API key to save.", "danger");
      return;
    }
    setSaving(true);
    try {
      await saveApiKey(selectedProvider, selectedModel, inputKey.trim());
      setInputKey("");
      await loadConfigured();
      toast("Key saved", `${provider.name} key encrypted and stored.`, "success");
    } catch (err) {
      toast("Save failed", err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (providerId: LLMProviderId, modelId: string) => {
    await revokeApiKey(providerId, modelId);
    await loadConfigured();
    toast("Key revoked", `${PROVIDERS[providerId].name} key removed.`, "ink");
  };

  const handleTest = async (providerId: LLMProviderId, modelId: string) => {
    setTesting(`${providerId}::${modelId}`);
    try {
      const key = await getApiKey(providerId, modelId);
      if (!key) {
        toast("No key", "No API key configured for this provider.", "danger");
        return;
      }

      const prov = PROVIDERS[providerId];
      let url = `${prov.baseUrl}${prov.apiPath}`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      if (providerId === "google") {
        url = url.replace("{model}", modelId) + `?key=${key}`;
      } else if (prov.authHeader) {
        headers[prov.authHeader] = `${prov.authPrefix || ""}${key}`;
      }

      const body =
        providerId === "anthropic"
          ? { model: modelId, max_tokens: 10, messages: [{ role: "user", content: "Hi" }] }
          : { model: modelId, messages: [{ role: "user", content: "Hi" }], max_tokens: 10 };

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (res.ok) {
        toast("Connection OK", `${prov.name} responded successfully.`, "success");
      } else {
        const text = await res.text().catch(() => "");
        toast("Connection failed", `${prov.name} returned ${res.status}: ${text.slice(0, 100)}`, "danger");
      }
    } catch (err) {
      toast("Connection failed", err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="grid gap-4">
      {/* Fallback chain explanation */}
      <GlassPanel className="p-5">
        <h2 className="font-display font-semibold">LLM providers & API keys</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Fallback chain: <strong>On-device</strong> → <strong>Backend</strong> → <strong>Your key (BYOK)</strong>.
          Keys are encrypted with WebCrypto and stored in IndexedDB — never sent to our servers.
        </p>

        {/* Fallback chain visual */}
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="rounded-lg bg-teal/10 px-2 py-1 font-medium text-teal">1. On-device (WebLLM)</span>
          <span className="text-ink-muted">→</span>
          <span className="rounded-lg bg-ink/10 px-2 py-1 font-medium text-ink-muted">2. Backend proxy</span>
          <span className="text-ink-muted">→</span>
          <span className="rounded-lg bg-amber-500/10 px-2 py-1 font-medium text-amber-600">3. Your API key</span>
        </div>
      </GlassPanel>

      {/* Configure key */}
      <GlassPanel className="p-5">
        <h2 className="font-display font-semibold">Configure API key</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Select a provider and model, then paste your API key.
        </p>

        {/* Provider selector */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">Provider</label>
            <select
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value as LLMProviderId);
                setSelectedModel("");
              }}
              className="w-full rounded-xl border border-line bg-white/50 px-3 py-2 text-sm"
            >
              {Object.values(PROVIDERS).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.costTier})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full rounded-xl border border-line bg-white/50 px-3 py-2 text-sm"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — ${m.costPerMToken.toFixed(2)}/M tokens
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* API key input */}
        <div className="mt-3">
          <label className="mb-1 block text-xs font-semibold text-ink-muted">API key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder={provider.keyUrl ? `Get key at ${new URL(provider.keyUrl).hostname}` : "Enter API key"}
              className="flex-1 rounded-xl border border-line bg-white/50 px-3 py-2 text-sm font-mono"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !inputKey.trim()}
              className={cn(
                "flex items-center gap-1 rounded-xl px-4 text-sm font-semibold text-white",
                saving || !inputKey.trim() ? "bg-line" : "bg-teal hover:bg-teal/80",
              )}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save
            </button>
          </div>
          {provider.keyUrl && (
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-teal hover:underline"
            >
              Get API key →
            </a>
          )}
        </div>
      </GlassPanel>

      {/* Configured keys list */}
      <GlassPanel className="p-5">
        <h2 className="font-display font-semibold">Configured keys</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {configured.length} key(s) stored. All encrypted with WebCrypto.
        </p>

        {configured.length === 0 && (
          <p className="mt-4 py-6 text-center text-sm text-ink-muted">No API keys configured.</p>
        )}

        <ul className="mt-4 divide-y divide-line">
          {configured.map((c) => {
            const prov = PROVIDERS[c.providerId];
            return (
              <li key={`${c.providerId}::${c.modelId}`} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <Key className="size-4 text-teal" />
                  <div>
                    <p className="text-sm font-semibold">{prov.name}</p>
                    <p className="text-xs text-ink-muted">
                      {prov.models.find((m) => m.id === c.modelId)?.name ?? c.modelId}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.lastUsedAt && (
                    <span className="text-[10px] text-ink-muted">
                      Last used: {new Date(c.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleTest(c.providerId, c.modelId)}
                    disabled={testing === `${c.providerId}::${c.modelId}`}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-teal hover:bg-teal/10"
                  >
                    {testing === `${c.providerId}::${c.modelId}` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Zap className="size-3" />
                    )}
                    Test
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(c.providerId, c.modelId)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="size-3" />
                    Revoke
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </GlassPanel>

      {/* Provider catalog */}
      <GlassPanel className="p-5">
        <h2 className="font-display font-semibold">Available providers</h2>
        <p className="mt-1 text-sm text-ink-muted">
          24 providers, 50+ models. One API key per provider. OpenRouter gives access to 100+ models with a single key.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.values(PROVIDERS).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelectedProvider(p.id);
                setSelectedModel(p.defaultModel);
              }}
              className={cn(
                "rounded-xl border p-3 text-left transition hover:border-teal",
                selectedProvider === p.id ? "border-teal bg-teal/5" : "border-line",
              )}
            >
              <p className="text-sm font-semibold">{p.name}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                <span className={cn(
                  "rounded px-1.5 py-0.5 font-medium",
                  p.costTier === "free" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                  p.costTier === "low" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                )}>
                  {p.costTier}
                </span>
                <span>{p.models.length} model(s)</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                {p.models.map((m) => m.name).join(", ")}
              </p>
            </button>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
