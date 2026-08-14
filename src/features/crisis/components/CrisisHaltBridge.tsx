import { useChatStore } from "@/features/chat/store/chatStore";
import { useAppStore } from "@/shared/store/appStore";
import { useEffect, useRef } from "react";

/** Hard-halts the CBT stream the moment the crisis overlay engages. */
export function CrisisHaltBridge() {
  const active = useAppStore((s) => s.crisisActive);
  const hardHalt = useChatStore((s) => s.hardHalt);
  const fired = useRef(false);

  useEffect(() => {
    if (active && !fired.current) {
      fired.current = true;
      hardHalt();
    }
    if (!active) fired.current = false;
  }, [active, hardHalt]);

  return null;
}
