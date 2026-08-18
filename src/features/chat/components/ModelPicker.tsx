import { useChatStore } from "@/features/chat/store/chatStore";
import { allModels } from "@/shared/lib/llmRegistry";
import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";

interface GroupedModel {
  providerId: string;
  providerName: string;
  models: { modelId: string; name: string }[];
}

export function ModelPicker() {
  const preferredProviderId = useChatStore((s) => s.preferredProviderId);
  const preferredModelId = useChatStore((s) => s.preferredModelId);
  const setPreferredModel = useChatStore((s) => s.setPreferredModel);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo<GroupedModel[]>(() => {
    const byProvider = new Map<string, GroupedModel>();
    for (const entry of allModels()) {
      const { provider, model } = entry;
      let g = byProvider.get(provider.id);
      if (!g) {
        g = { providerId: provider.id, providerName: provider.name, models: [] };
        byProvider.set(provider.id, g);
      }
      g.models.push({ modelId: model.id, name: model.name });
    }
    return [...byProvider.values()];
  }, []);

  const currentProvider = groups.find((g) => g.providerId === preferredProviderId);
  const currentModel = currentProvider?.models.find((m) => m.modelId === preferredModelId);

  const label = currentModel
    ? `${currentProvider?.providerName} · ${currentModel.name}`
    : "Auto · on-device";

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select model"
        className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-xl bg-canvas px-2.5 py-2 text-xs font-medium text-ink-mute hover:text-ink"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={listRef}
            role="listbox"
            aria-label="Model list"
            className="absolute bottom-full left-0 z-50 mb-1 max-h-72 w-72 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-line"
          >
            <button
              type="button"
              role="option"
              aria-selected={!currentModel}
              onClick={() => {
                setPreferredModel("", "");
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-canvas"
            >
              <span className="font-medium">Auto</span>
              <span className="text-[11px] text-ink-mute">on-device → backend → BYOK</span>
            </button>

            {groups.map((g) => (
              <div key={g.providerId} className="mt-1 border-t border-line pt-1 first:border-t-0 first:pt-0">
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
                  {g.providerName}
                </p>
                {g.models.map((m) => (
                  <button
                    key={m.modelId}
                    type="button"
                    role="option"
                    aria-selected={g.providerId === preferredProviderId && m.modelId === preferredModelId}
                    onClick={() => {
                      setPreferredModel(g.providerId, m.modelId);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-canvas",
                      g.providerId === preferredProviderId && m.modelId === preferredModelId
                        ? "bg-teal-mist text-teal"
                        : "text-ink",
                    )}
                  >
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-ink-mute">{m.modelId}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
