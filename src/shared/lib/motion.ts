import type { Transition } from "framer-motion";

/** Global spring used by every spatial / drag interaction. */
export const spring: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 25,
};

export const softSpring: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 28,
};

export const snapSpring: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30,
};
