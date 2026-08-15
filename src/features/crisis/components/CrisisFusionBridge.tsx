import { useChatStore } from "@/features/chat/store/chatStore";
import { useAppStore } from "@/shared/store/appStore";
import { useEffect, useRef } from "react";
import {
  computeCrisisScore,
  computeDistressHint,
  CRISIS_FUSION_THRESHOLD,
} from "../lib/crisisFusion";

const POLL_MS = 500;

/**
 * Multimodal crisis fusion bridge.
 *
 * Polls the shared signals (latest user text, live mic prosody, MediaPipe face
 * expression) and evaluates computeCrisisScore(). When the weighted score
 * crosses the threshold the crisis protocol is engaged — ratifying distress
 * that pure keyword detection alone would miss (e.g. distress + raised voice).
 *
 * Sub-threshold but face-distressed states feed the on-screen distress hint.
 * The bridge is the single writer of distressHint (CameraPip only updates
 * chat.face), so it owns the cleanup on unmount and camera close.
 */
export function CrisisFusionBridge() {
  const triggerCrisis = useAppStore((s) => s.triggerCrisis);
  const setDistressHint = useAppStore((s) => s.setDistressHint);
  const lastHint = useRef<boolean | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      const chat = useChatStore.getState();
      const app = useAppStore.getState();

      const latestUser = [...chat.messages]
        .reverse()
        .find((m) => m.role === "user");
      const result = computeCrisisScore({
        text: latestUser?.content ?? "",
        prosody: chat.prosody,
        face: chat.face,
      });

      // Only update the hint on an actual change — avoids a set() every poll.
      const hint = computeDistressHint(chat.face);
      if (hint !== lastHint.current) {
        lastHint.current = hint;
        setDistressHint(hint);
      }

      if (result.shouldTrigger && !app.crisisActive) {
        triggerCrisis(
          `Multimodal crisis detected (score ${result.score.toFixed(2)} > ${CRISIS_FUSION_THRESHOLD}). The crisis protocol was engaged locally.`,
        );
      }
    }, POLL_MS);

    return () => {
      window.clearInterval(id);
      setDistressHint(false);
      lastHint.current = null;
    };
  }, [triggerCrisis, setDistressHint]);

  return null;
}
