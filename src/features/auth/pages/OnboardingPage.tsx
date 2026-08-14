import { ConsentSlider } from "@/features/auth/components/ConsentSlider";
import { OnboardingStepper } from "@/features/auth/components/OnboardingStepper";
import { PersonalizedVault } from "@/features/auth/components/PersonalizedVault";
import { CONSENT_CLAUSES } from "@/features/auth/lib/consent";
import { THERAPY_GOALS } from "@/features/auth/lib/goals";
import { useAuthStore } from "@/features/auth/store/authStore";
import { Button } from "@/shared/ui/Button";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

export function OnboardingPage() {
  const status = useAuthStore((s) => s.status);
  const profile = useAuthStore((s) => s.profile);
  const step = useAuthStore((s) => s.step);
  const setStep = useAuthStore((s) => s.setStep);
  const acceptConsent = useAuthStore((s) => s.acceptConsent);
  const finishOnboarding = useAuthStore((s) => s.finishOnboarding);
  const navigate = useNavigate();

  if (status === "anonymous") return <Navigate to="/auth" replace />;
  if (status === "onboarded") return <Navigate to="/chat" replace />;

  const consented = Boolean(profile?.consentAcceptedAt);
  const canFinish = consented && (profile?.goals.length ?? 0) > 0;

  const goNext = () => {
    if (step === "disclosure") setStep("consent");
    else if (step === "consent" && consented) setStep("goals");
    else if (step === "goals" && canFinish) setStep("emergency");
    else if (step === "emergency" && canFinish) {
      finishOnboarding();
      navigate("/chat");
    }
  };

  const goBack = () => {
    if (step === "consent") setStep("disclosure");
    if (step === "goals") setStep("consent");
    if (step === "emergency") setStep("goals");
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-y-auto bg-canvas">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-ink font-display text-sm font-extrabold text-white">
            C
          </div>
          <div>
            <p className="font-display text-sm font-bold">Clinical onboarding</p>
            <p className="text-[11px] text-ink-mute">{profile?.displayName} · {profile?.email}</p>
          </div>
        </div>
        <span className="rounded-full bg-teal-mist px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal">
          {profile?.authMethod === "passkey" ? "Passkey" : "Magic link"}
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
        <OnboardingStepper current={step} />

        <AnimatePresence mode="wait">
          <motion.section
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="flex-1"
          >
            {step === "disclosure" && <DisclosureStep name={profile?.displayName ?? "there"} />}
            {step === "consent" && (
              <ConsentStep accepted={consented} onAccept={acceptConsent} />
            )}
            {step === "goals" && <GoalsStep count={profile?.goals.length ?? 0} />}
            {step === "emergency" && <EmergencyStep />}
          </motion.section>
        </AnimatePresence>

        <footer className="mt-8 flex items-center justify-between gap-3 pb-6">
          <Button variant="ghost" onClick={goBack} disabled={step === "disclosure"}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button
            onClick={goNext}
            disabled={(step === "consent" && !consented) || (step === "goals" && !canFinish)}
          >
            {step === "goals" ? "Enter workspace" : "Continue"}
            <ArrowRight className="size-4" />
          </Button>
        </footer>
      </main>
    </div>
  );
}

function DisclosureStep({ name }: { name: string }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Hello, {name}.</h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-ink-mute">
        Before any thought record is written, we name the scope. This agent is a private CBT
        studio — not a therapist, not a crisis line, not a cloud journal.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {[
          {
            title: "It will",
            items: [
              "Hold core memories you choose to pin",
              "Run camera / mic models on-device",
              "Halt hard if crisis language appears",
            ],
          },
          {
            title: "It will not",
            items: [
              "Upload raw media or session audio",
              "Diagnose or prescribe",
              "Replace a licensed human clinician",
            ],
          },
        ].map((col) => (
          <article key={col.title} className="rounded-[1.4rem] bg-white p-5 ring-1 ring-line">
            <h2 className="font-display text-sm font-bold">{col.title}</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-mute">
              {col.items.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-2xl bg-danger-mist px-4 py-3 text-sm text-[#7f1d1d]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        If you are in immediate danger, stop here and call local emergency services or 988 / 119.
      </div>
    </div>
  );
}

function ConsentStep({ accepted, onAccept }: { accepted: boolean; onAccept: () => void }) {
  const [read, setRead] = useState(accepted);

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 16) setRead(true);
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Informed consent</h1>
      <p className="mt-2 text-sm leading-7 text-ink-mute">
        Scroll every clause. The slider stays locked until the list reaches the bottom. Then drag
        to accept. Keyboard: focus the handle and press End.
      </p>
      <div
        onScroll={onScroll}
        className="scrollbar-thin mt-5 max-h-[min(42dvh,360px)] space-y-3 overflow-y-auto pr-1"
      >
        {CONSENT_CLAUSES.map((clause) => (
          <article key={clause.id} className="rounded-2xl bg-white p-4 ring-1 ring-line">
            <h2 className="font-display text-sm font-bold">{clause.title}</h2>
            <p className="mt-1 text-sm leading-6 text-ink-mute">{clause.body}</p>
          </article>
        ))}
        <p className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-teal">
          End of clinical consent · 2026.08-cbt-1
        </p>
      </div>
      <div className="mt-5">
        {read || accepted ? (
          <ConsentSlider accepted={accepted} onAccept={onAccept} />
        ) : (
          <div className="flex h-16 items-center justify-center rounded-full bg-ink/[0.06] text-sm font-semibold text-ink-mute">
            Scroll to the last clause to unlock the slider
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-mute">
          Version 2026.08-cbt-1 · recorded locally · withdraw anytime from Privacy
        </p>
      </div>
    </div>
  );
}

function EmergencyStep() {
  const emergency = useAuthStore((s) => s.profile?.emergency);
  const setEmergency = useAuthStore((s) => s.setEmergency);
  const [name, setName] = useState(emergency?.name ?? "");
  const [phone, setPhone] = useState(emergency?.phone ?? "");
  const [notify, setNotify] = useState(emergency?.notify ?? false);

  const persist = (next: { name?: string; phone?: string; notify?: boolean }) => {
    const merged = {
      name: next.name ?? name,
      phone: next.phone ?? phone,
      notify: next.notify ?? notify,
    };
    if (!merged.name.trim() && !merged.phone.trim()) {
      setEmergency(null);
      return;
    }
    setEmergency(merged);
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Emergency contact</h1>
      <p className="mt-2 text-sm leading-7 text-ink-mute">
        Optional. If the crisis protocol fires, we can show this person — the number never leaves
        this device.
      </p>
      <div className="mt-5 space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-mute">
          Name
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              persist({ name: e.target.value });
            }}
            className="mt-1.5 h-12 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-teal"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-mute">
          Phone / WhatsApp
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              persist({ phone: e.target.value });
            }}
            placeholder="+62 …"
            className="mt-1.5 h-12 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-teal"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-mute">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => {
              setNotify(e.target.checked);
              persist({ notify: e.target.checked });
            }}
          />
          Show this contact on the crisis overlay
        </label>
      </div>
    </div>
  );
}

function GoalsStep({ count }: { count: number }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Build your vault</h1>
      <p className="mt-2 text-sm leading-7 text-ink-mute">
        Drag one or more therapy targets into the Personalized Vault. These become the default
        lens for the spatial workspace. You can click a chip if dragging isn&apos;t available.
      </p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-teal">
        {count} of {THERAPY_GOALS.length} seated
      </p>
      <div className="mt-4">
        <PersonalizedVault />
      </div>
    </div>
  );
}
