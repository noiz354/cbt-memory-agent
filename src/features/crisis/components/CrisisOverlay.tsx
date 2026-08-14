import { useAuthStore } from "@/features/auth/store/authStore";
import { BreathingCircle } from "@/features/crisis/components/BreathingCircle";
import { GroundingGame } from "@/features/crisis/components/GroundingGame";
import { CalmingAudio } from "@/features/crisis/components/CalmingAudio";
import { SwipeToCall } from "@/features/crisis/components/SwipeToCall";
import { useAuditStore } from "@/shared/store/auditStore";
import { useAppStore } from "@/shared/store/appStore";
import { AnimatePresence, motion } from "framer-motion";
import { Hospital, MessageCircle, Phone, ShieldAlert, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function CrisisOverlay() {
  const active = useAppStore((s) => s.crisisActive);
  const reason = useAppStore((s) => s.crisisReason);
  const dismissCrisis = useAppStore((s) => s.dismissCrisis);
  const emergency = useAuthStore((s) => s.profile?.emergency);
  const [grounded, setGrounded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) {
      setGrounded(false);
      return;
    }
    useAuditStore.getState().log("CRISIS_ENGAGED", reason ?? "unspecified");
    const root = rootRef.current;
    const focusable = () =>
      root?.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]:not([tabindex='-1'])") ?? [];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const nodes = [...focusable()];
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, reason]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          ref={rootRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="crisis-title"
          className="fixed inset-0 z-[99999] flex flex-col overflow-y-auto bg-ink/80 backdrop-blur-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <header className="bg-danger px-5 py-5 text-white shadow-[0_12px_40px_rgba(220,38,38,0.35)]">
            <p className="inline-flex items-center gap-2 font-display text-[11px] font-bold uppercase tracking-[0.22em]">
              <ShieldAlert className="size-3.5" />
              Global crisis protocol
            </p>
            <h2 id="crisis-title" className="mt-1 font-display text-2xl font-extrabold">
              Hard halt · you are not alone
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-white/90">
              {reason ?? "The CBT session has been stopped. Help is one slide away."}
            </p>
            <p className="mt-2 text-xs text-white/75">This account is not blocked. The session is secured on-device.</p>
          </header>

          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6">
            <SwipeToCall />

            <div className="grid gap-2 sm:grid-cols-2">
              <a
                href="sms:119?body=I%20need%20crisis%20support"
                className="flex items-center gap-3 rounded-2xl bg-white/8 px-3 py-3 text-sm text-white"
              >
                <MessageCircle className="size-4 text-teal-soft" />
                Crisis text / SMS 119
              </a>
              <a
                href="https://www.google.com/maps/search/UGD+rumah+sakit+terdekat"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-2xl bg-white/8 px-3 py-3 text-sm text-white"
              >
                <Hospital className="size-4 text-teal-soft" />
                Find nearest emergency department
              </a>
              {emergency?.notify && emergency.phone && (
                <a
                  href={`tel:${emergency.phone}`}
                  className="flex items-center gap-3 rounded-2xl bg-white/8 px-3 py-3 text-sm text-white sm:col-span-2"
                >
                  <UserRound className="size-4 text-teal-soft" />
                  Call {emergency.name || "personal contact"} · {emergency.phone}
                </a>
              )}
              <a
                href="tel:988"
                className="flex items-center gap-3 rounded-2xl bg-danger px-3 py-3 text-sm font-semibold text-white sm:col-span-2"
              >
                <Phone className="size-4" />
                Direct call 988 Lifeline
              </a>
            </div>

            <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-start">
              <div className="flex flex-col items-center gap-3">
                <BreathingCircle onCycle={() => setGrounded(true)} />
                <CalmingAudio />
              </div>
              <GroundingGame onComplete={() => setGrounded(true)} />
            </div>
            <button
              type="button"
              disabled={!grounded}
              onClick={() => {
                useAuditStore.getState().log("CRISIS_DISMISSED", "user marked safe after grounding");
                dismissCrisis();
              }}
              className="mb-4 self-center text-sm font-semibold text-white/45 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              {grounded
                ? "I am safe for now — return to the workspace"
                : "Hold a breath cycle or seat five anchors to unlock exit"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
