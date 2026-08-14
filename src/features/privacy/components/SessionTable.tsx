import { useAuthStore } from "@/features/auth/store/authStore";
import { usePrivacyStore } from "@/features/privacy/store/privacyStore";
import { formatDay } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { motion } from "framer-motion";
import { useState } from "react";
import { broadcastSignOut } from "@/shared/ui/TabSync";
import { useNavigate } from "react-router-dom";

export function SessionTable() {
  const devices = usePrivacyStore((s) => s.devices);
  const revoke = usePrivacyStore((s) => s.revoke);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {devices.map((device) => (
        <div key={device.id} className="relative overflow-hidden rounded-2xl">
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center bg-danger text-xs font-bold text-white"
            onClick={() => {
              if (device.current) {
                broadcastSignOut();
                signOut();
                navigate("/auth");
                return;
              }
              revoke(device.id);
              setOpenId(null);
            }}
          >
            Revoke
          </button>
          <motion.div
            drag="x"
            dragConstraints={{ left: -88, right: 0 }}
            dragElastic={0.06}
            onDragEnd={(_, info) => setOpenId(info.offset.x < -48 ? device.id : null)}
            animate={{ x: openId === device.id ? -88 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="relative z-10 flex items-center justify-between gap-3 bg-white px-3 py-3 ring-1 ring-line"
          >
            <div>
              <p className="font-display text-sm font-semibold">{device.label}</p>
              <p className="text-[11px] text-ink-mute">
                {device.method} · {device.place} · {formatDay(device.lastActive)}
              </p>
            </div>
            {device.current ? <Badge tone="success">Current</Badge> : <Badge>Swipe left</Badge>}
          </motion.div>
        </div>
      ))}
      <p className="text-[11px] text-ink-mute">Swipe a row left to reveal Revoke. Current device signs you out.</p>
    </div>
  );
}
