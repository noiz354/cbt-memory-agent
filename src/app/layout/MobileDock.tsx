import { APP_NAV } from "@/app/layout/nav";
import { useAppStore } from "@/shared/store/appStore";
import { cn } from "@/shared/lib/cn";
import { NavLink } from "react-router-dom";
import { HeartPulse } from "lucide-react";

export function MobileDock() {
  const triggerCrisis = useAppStore((s) => s.triggerCrisis);
  const distressHint = useAppStore((s) => s.distressHint);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <nav className="pointer-events-auto glass mx-auto flex max-w-lg items-center justify-around rounded-full px-2 py-2 shadow-[var(--shadow-float)]">
        {APP_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={({ isActive }) =>
                cn(
                  "flex size-11 items-center justify-center rounded-full transition-colors",
                  isActive ? "bg-ink text-white" : "text-ink-mute hover:bg-ink/6",
                )
              }
            >
              <Icon className="size-5" />
            </NavLink>
          );
        })}
        <button
          type="button"
          aria-label="Open crisis protocol"
          onClick={() => triggerCrisis("Manual override from mobile dock.")}
          className={cn(
            "flex size-11 items-center justify-center rounded-full bg-danger text-white",
            distressHint && "ring-2 ring-white",
          )}
        >
          <HeartPulse className="size-5" />
        </button>
      </nav>
    </div>
  );
}
