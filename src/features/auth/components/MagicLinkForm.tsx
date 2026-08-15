import { useAuthStore } from "@/features/auth/store/authStore";
import { Button } from "@/shared/ui/Button";
import { AnimatePresence, motion } from "framer-motion";
import { Inbox, Loader2, Mail, Send } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

interface MagicLinkFormProps {
  email: string;
  displayName: string;
}

export function MagicLinkForm({ email, displayName }: MagicLinkFormProps) {
  const issueMagicLink = useAuthStore((s) => s.issueMagicLink);
  const [token, setToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email — it labels the local session only.");
      return;
    }
    setError(null);
    setLoading(true);
    const res = await issueMagicLink(email, displayName);
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Failed to request a magic link. Try again.");
      return;
    }
    if (res.sent) {
      setSent(true);
      setToken(null);
    } else {
      setSent(false);
      setToken(res.token);
    }
  };

  return (
    <div>
      <Button className="w-full" size="lg" onClick={send} disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
        {loading ? "Sending…" : "Email me a magic link"}
      </Button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {sent && (
        <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-teal-700">
          <Send className="size-3.5" />
          Sign-in link sent to {email}. Check your inbox — it expires in 10 minutes.
        </p>
      )}

      <AnimatePresence>
        {!sent && token && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="glass mt-4 rounded-2xl p-4"
          >
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700">
              <Inbox className="size-3.5" />
              On-device inbox preview
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-mute">
              No mail server configured in this build, so the link below is shown here instead of
              being emailed. Consuming it authenticates this browser only.
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
