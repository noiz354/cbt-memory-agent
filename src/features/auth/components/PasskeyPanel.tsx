import { mintLocalDeviceKey, mintPasskey, platformPasskeyAvailable } from "@/features/auth/lib/passkey";
import { useAuthStore } from "@/features/auth/store/authStore";
import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";
import { Button } from "@/shared/ui/Button";
import { AnimatePresence, motion } from "framer-motion";
import { Fingerprint, LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface PasskeyPanelProps {
  email: string;
  displayName: string;
}

type Phase = "idle" | "prompting" | "local" | "done" | "error";

export function PasskeyPanel({ email, displayName }: PasskeyPanelProps) {
  const completeAuth = useAuthStore((s) => s.completeAuth);
  const signInWithPasskey = useAuthStore((s) => s.signInWithPasskey);
  const hasRegisteredPasskey = useAuthStore((s) => s.hasRegisteredPasskey);
  const navigate = useNavigate();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    void platformPasskeyAvailable().then(setSupported);
    setHasPasskey(hasRegisteredPasskey());
  }, [hasRegisteredPasskey]);

  const finish = (credentialId: string, methodNote: string) => {
    completeAuth({
      email,
      displayName,
      method: "passkey",
      credentialId,
    });
    track(TELEMETRY_EVENTS.signupCompleted, { method: "passkey" });
    setPhase("done");
    setNote(methodNote);
    window.setTimeout(() => navigate("/onboarding"), 700);
  };

  const run = async () => {
    if (!email.includes("@")) {
      setNote("Add an email so this device key has a human label.");
      setPhase("error");
      return;
    }
    setPhase("prompting");
    setNote(null);
    const result = await mintPasskey(email);
    if (result.ok) {
      finish(result.credentialId, "Platform authenticator verified. Key stays on-device.");
      return;
    }
    if (result.reason === "cancelled") {
      setPhase("idle");
      setNote("Passkey prompt dismissed.");
      return;
    }
    setPhase("local");
    await new Promise((r) => setTimeout(r, 900));
    const local = mintLocalDeviceKey();
    finish(local.credentialId, "Sandbox has no platform authenticator — a local device key was minted instead. Still zero-cloud.");
  };

  const signIn = async () => {
    setSigningIn(true);
    setNote(null);
    const result = await signInWithPasskey();
    setSigningIn(false);
    if (result.ok) {
      setPhase("done");
      setNote("Passkey verified. Welcome back.");
      window.setTimeout(() => navigate("/onboarding"), 700);
      return;
    }
    if (result.reason === "cancelled") {
      setPhase("idle");
      setNote("Passkey prompt dismissed.");
      return;
    }
    if (result.reason === "unregistered") {
      setPhase("error");
      setNote("No registered passkey found for this browser.");
      return;
    }
    setPhase("error");
    setNote("Could not verify with the platform authenticator.");
  };

  return (
    <div>
      <Button className="w-full" size="lg" onClick={() => void run()} disabled={phase === "prompting" || phase === "local" || phase === "done"}>
        {phase === "prompting" || phase === "local" ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Fingerprint className="size-4" />
        )}
        {phase === "done" ? "Verified" : "Continue with passkey"}
      </Button>
      <p className="mt-2 text-center text-[11px] text-ink-mute">
        {supported === false
          ? "This browser has no platform authenticator. We will mint a local device key."
          : "Uses WebAuthn when the OS offers Face ID, Touch ID, or Windows Hello."}
      </p>

      {hasPasskey && (
        <Button
          className="mt-2 w-full"
          size="lg"
          variant="ghost"
          onClick={() => void signIn()}
          disabled={signingIn || phase === "done"}
        >
          {signingIn ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          {signingIn ? "Verifying…" : "Sign in with an existing passkey"}
        </Button>
      )}

      <AnimatePresence>
        {(phase === "prompting" || phase === "local" || phase === "done") && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="mt-4 rounded-2xl bg-ink px-4 py-4 text-white"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-teal/20 text-teal-soft">
                {phase === "done" ? <ShieldCheck className="size-5" /> : <Fingerprint className="size-5" />}
              </span>
              <div>
                <p className="font-display text-sm font-semibold">
                  {phase === "done" ? "Device key sealed" : phase === "local" ? "Minting local device key" : "Waiting on authenticator"}
                </p>
                <p className="text-xs text-white/55">
                  {note ?? "Biometric material is verified by the OS. We only store a credential id."}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {phase === "error" && note && (
        <p className="mt-3 text-center text-sm text-danger">{note}</p>
      )}
    </div>
  );
}
