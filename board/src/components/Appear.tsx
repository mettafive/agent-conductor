import type { ReactNode } from "react";
import { motion } from "framer-motion";

// One easing + timing for "something just appeared" across the whole app, so
// marks and text fade/scale in elegantly instead of popping. easeOut, quick.
const EASE = "easeOut" as const;

/**
 * An icon/mark that eases in (fade + slight scale). Pass `swap` (e.g. the gate
 * result) so it re-animates each time the mark changes — a checkmark gliding in
 * when a gate passes, rather than snapping.
 */
export function AppearIcon({
  swap,
  children,
}: {
  swap?: string | number | boolean;
  children: ReactNode;
}) {
  return (
    <motion.span
      key={String(swap)}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: EASE }}
      className="inline-flex"
    >
      {children}
    </motion.span>
  );
}
