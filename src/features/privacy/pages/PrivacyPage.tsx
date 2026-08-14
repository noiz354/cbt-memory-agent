import { DestructionKey } from "@/features/privacy/components/DestructionKey";
import { ExportBuilder } from "@/features/privacy/components/ExportBuilder";
import { SessionTable } from "@/features/privacy/components/SessionTable";
import { LlmPanel } from "@/features/privacy/components/LlmPanel";
import { useAuditStore } from "@/shared/store/auditStore";
import { useThemeStore, type ThemeMode } from "@/shared/store/themeStore";
import { cn } from "@/shared/lib/cn";
import { formatClock, formatDay } from "@/shared/lib/format";
import { GlassPanel } from "@/shared/ui/GlassPanel";
import { useState } from "react";

const TABS = [
  { id: "security", label: "Security" },
  { id: "data", label: "Data rights" },
  { id: "llm", label: "LLM" },
  { id: "prefs", label: "Preferences" },
  { id: "audit", label: "Audit" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export function PrivacyPage() {
  const [tab, setTab] = useState<Tab>("security");

  return (
    <div className="h-full overflow-auto p-5">
      <header className="mb-5">
        <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
          Data hub
        </p>
        <h1 className="font-display text-2xl font-bold">Privacy & security</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-mute">
          Every control writes only to this browser. Raw media never leaves the device.
        </p>
        <div className="mt-4 flex flex-wrap gap-1 rounded-2xl bg-white p-1 ring-1 ring-line">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "h-9 rounded-xl px-3 text-sm font-semibold",
                tab === item.id ? "bg-ink text-white" : "text-ink-mute",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {tab === "security" && (
        <GlassPanel className="p-5">
          <h2 className="font-display font-semibold">Active sessions</h2>
          <p className="mb-4 mt-1 text-sm text-ink-mute">Swipe left on a row to reveal Revoke.</p>
          <SessionTable />
        </GlassPanel>
      )}

      {tab === "data" && (
        <div className="grid gap-4">
          <GlassPanel className="p-5">
            <h2 className="font-display font-semibold">Export builder</h2>
            <p className="mb-4 mt-1 text-sm text-ink-mute">
              Compose a local JSON bundle. Snapshots are omitted.
            </p>
            <ExportBuilder />
          </GlassPanel>
          <GlassPanel className="border border-danger/25 p-5">
            <h2 className="font-display font-semibold text-danger">Hard purge · danger zone</h2>
            <p className="mb-4 mt-1 max-w-2xl text-sm text-ink-mute">
              Type the confirmation sentence, seat the red key, then hold three seconds.
            </p>
            <DestructionKey />
          </GlassPanel>
        </div>
      )}

      {tab === "llm" && <LlmPanel />}

      {tab === "prefs" && <PrefsPanel />}
      {tab === "audit" && <AuditPanel />}
    </div>
  );
}

function PrefsPanel() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  return (
    <GlassPanel className="p-5">
      <h2 className="font-display font-semibold">Theme & accessibility</h2>
      <p className="mt-1 text-sm text-ink-mute">Instant token shift. Contrast stays WCAG AA.</p>
      <div className="mt-4 flex gap-2">
        {(["light", "dark", "system"] as ThemeMode[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              "h-10 rounded-xl px-4 text-sm font-semibold capitalize",
              mode === id ? "bg-ink text-white" : "bg-canvas text-ink-mute",
            )}
          >
            {id}
          </button>
        ))}
      </div>
    </GlassPanel>
  );
}

function AuditPanel() {
  const events = useAuditStore((s) => s.events);
  return (
    <GlassPanel className="p-5">
      <h2 className="font-display font-semibold">Compliance audit log</h2>
      <p className="mt-1 text-sm text-ink-mute">Local, read-only, last 80 events.</p>
      <ul className="mt-4 divide-y divide-line">
        {events.map((event) => (
          <li key={event.id} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div>
              <p className="font-semibold">{event.type}</p>
              <p className="text-xs text-ink-mute">{event.detail}</p>
            </div>
            <p className="shrink-0 text-[11px] text-ink-mute">
              {formatDay(event.at)} {formatClock(event.at)}
            </p>
          </li>
        ))}
        {events.length === 0 && <li className="py-6 text-sm text-ink-mute">No events yet.</li>}
      </ul>
    </GlassPanel>
  );
}
