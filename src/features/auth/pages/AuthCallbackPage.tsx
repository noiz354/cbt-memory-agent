import { AuthShell } from "@/features/auth/components/AuthShell";
import { useAuthStore } from "@/features/auth/store/authStore";
import { Button } from "@/shared/ui/Button";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const consumeMagicLink = useAuthStore((s) => s.consumeMagicLink);
  const status = useAuthStore((s) => s.status);
  const navigate = useNavigate();
  const [ok, setOk] = useState<boolean | null>(null);
  // Guard against the double-consume bug: `params` object identity changes on every
  // render, so the effect used to run twice — first consume succeeded (clearing the
  // token), the second found magicToken===null and flipped the UI to "Link not valid"
  // even though the user WAS authenticated. Run the consume logic exactly once.
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;

    // Already authenticated (e.g. re-entry after the first consume) → success.
    if (status === "authenticated" || status === "onboarded") {
      setOk(true);
      const timer = window.setTimeout(() => navigate("/onboarding"), 800);
      return () => window.clearTimeout(timer);
    }

    const token = params.get("token");
    if (!token) {
      setOk(false);
      return;
    }
    const accepted = consumeMagicLink(token);
    setOk(accepted);
    if (accepted) {
      const timer = window.setTimeout(() => navigate("/onboarding"), 800);
      return () => window.clearTimeout(timer);
    }
  }, [consumeMagicLink, navigate, params, status]);

  return (
    <AuthShell
      eyebrow="Magic link"
      title={ok ? "Link consumed" : ok === false ? "Link not valid" : "Opening session"}
      lede={
        ok
          ? "This browser is now authenticated. Next is informed consent — not a checkbox."
          : ok === false
            ? "The token is missing, expired, or already used. Request a new link from the sign-in page."
            : "Validating the one-time token on this device."
      }
    >
      {ok === false && (
        <Button className="w-full" onClick={() => navigate("/auth")}>
          Return to sign in
        </Button>
      )}
    </AuthShell>
  );
}
