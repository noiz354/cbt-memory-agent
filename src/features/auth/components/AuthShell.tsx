import { cn } from "@/shared/lib/cn";
import { ShieldCheck, Sparkles, Waves } from "lucide-react";
import type { ReactNode } from "react";

const PILLARS = [
  { icon: ShieldCheck, title: "On-device keys", copy: "Passkeys and session material never leave this browser profile." },
  { icon: Waves, title: "Zero-cloud media", copy: "Camera and microphone are scored in Web Workers. Raw frames stay here." },
  { icon: Sparkles, title: "Revocable memory", copy: "You can export, decay, or hard-purge the vault from Privacy at any time." },
];

interface AuthShellProps {
  eyebrow: string;
  title: string;
  lede: string;
  children: ReactNode;
  wide?: boolean;
}

export function AuthShell({ eyebrow, title, lede, children, wide = false }: AuthShellProps) {
  return (
    <div className="flex min-h-[100dvh] overflow-y-auto bg-canvas">
      <aside className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-ink px-10 py-10 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 spatial-grid opacity-20" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-teal font-display text-lg font-extrabold">
              C
            </div>
            <div>
              <p className="font-display text-sm font-bold">CBT Memory Agent</p>
              <p className="text-[11px] text-white/45">Clinical workspace · 2026</p>
            </div>
          </div>
          <h2 className="mt-16 max-w-sm font-display text-4xl font-extrabold leading-[1.1] tracking-tight">
            Private cognition, processed on this device.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-6 text-white/60">
            A spatial CBT studio with informed consent, a sealed memory vault, and a hard-halt
            crisis protocol. No password store. No raw media on the wire.
          </p>
        </div>
        <ul className="relative space-y-4">
          {PILLARS.map(({ icon: Icon, title: itemTitle, copy }) => (
            <li key={itemTitle} className="flex gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/8 text-teal-soft">
                <Icon className="size-4" />
              </span>
              <span>
                <span className="block font-display text-sm font-semibold">{itemTitle}</span>
                <span className="mt-0.5 block text-xs leading-5 text-white/50">{copy}</span>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className={cn("w-full", wide ? "max-w-3xl" : "max-w-md")}>
          <div className="mb-6 lg:hidden">
            <p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-teal">
              CBT Memory Agent
            </p>
          </div>
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-teal">
            {eyebrow}
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-mute">{lede}</p>
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
