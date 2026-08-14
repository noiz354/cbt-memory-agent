import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(() => (typeof navigator === "undefined" ? false : !navigator.onLine));

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[90] bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-ink">
      Offline — camera, mic, and vault stay on this device. Network features will retry when you reconnect.
    </div>
  );
}
