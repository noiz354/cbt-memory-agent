import { AuthShell } from "@/features/auth/components/AuthShell";
import { MagicLinkForm } from "@/features/auth/components/MagicLinkForm";
import { PasskeyPanel } from "@/features/auth/components/PasskeyPanel";
import { useAuthStore } from "@/features/auth/store/authStore";
import { cn } from "@/shared/lib/cn";
import { useState } from "react";
import { Navigate } from "react-router-dom";

type Tab = "passkey" | "magic";

export function AuthPage() {
  const status = useAuthStore((s) => s.status);
  const pendingEmail = useAuthStore((s) => s.pendingEmail);
  const [tab, setTab] = useState<Tab>("passkey");
  const [email, setEmail] = useState(pendingEmail);
  const [displayName, setDisplayName] = useState("");

  if (status === "onboarded") return <Navigate to="/chat" replace />;
  if (status === "authenticated") return <Navigate to="/onboarding" replace />;

  return (
    <AuthShell
      eyebrow="Secure entry"
      title="Sign in privately"
      lede="Passkeys or a one-time magic link. No password is stored, and the session key never leaves this device. Media is analyzed on-device — only the clinical summary (plus your explicit snapshot uploads) syncs to your private memory vault."
    >
      <div className="space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-mute">
          What should we call you
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Preferred name"
            className="mt-1.5 h-12 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-teal"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-mute">
          Email label
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@clinic.org"
            autoComplete="username webauthn"
            className="mt-1.5 h-12 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-teal"
          />
        </label>
      </div>

      <div className="mt-5 grid grid-cols-2 rounded-2xl bg-canvas p-1">
        {(["passkey", "magic"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "h-10 rounded-xl text-sm font-semibold capitalize transition-colors",
              tab === id ? "bg-white text-ink shadow-sm" : "text-ink-mute",
            )}
          >
            {id === "passkey" ? "Passkey" : "Magic link"}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "passkey" ? (
          <PasskeyPanel email={email} displayName={displayName} />
        ) : (
          <MagicLinkForm email={email} displayName={displayName} />
        )}
      </div>
    </AuthShell>
  );
}
