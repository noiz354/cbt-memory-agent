import { useAuthStore } from "@/features/auth/store/authStore";
import { Button } from "@/shared/ui/Button";
import { AnimatePresence, motion } from "framer-motion";
import { Inbox, Mail } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

interface MagicLinkFormProps {
  email: string;
  displayName: string;
}

export function MagicLinkForm({ email, displayName }: MagicLinkFormProps) {
  const issueMagicLink = useAuthStore((s) => s.issueMagicLink);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email — it labels the local session only.");
      return;
    }
    setError(null);
    setToken(issueMagicLink(email, displayName));
  };

  return (
    <div>
      <Button className="w-full" size="lg" onClick={send}>
        <Mail className="size-4" />
        Email me a magic link
      </Button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <AnimatePresence>
        {token && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="glass mt-4 rounded-2xl p-4"
          >
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal">
              <Inbox className="size-3.5" />
              On-device inbox preview
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-mute">
              There is no mail server in this build. The link below is the same artifact a
              production sender would deliver — consuming it authenticates this browser only.
            </p>
            <Link
              to={`/auth/callback?token=${token}`}
              className="mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-ink px-4 text-sm font-semibold text-white"
            >
              Open magic link
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
