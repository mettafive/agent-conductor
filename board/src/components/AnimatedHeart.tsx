import { useEffect, useRef, useState } from "react";
import { useNow } from "../lib/useNow";
import { secondsSince } from "../lib/heartbeat";

const STALL_SECONDS = 90;

interface Props {
  /** Timestamp of the most recent beat this heart tracks. */
  lastBeatIso?: string;
  size?: number;
  /** Title/tooltip text. */
  title?: string;
  /** quiet-threshold in seconds (derived from the configured heartbeat interval) */
  stallSeconds?: number;
}

/**
 * A beating heart — same icon throughout, only its colour carries state: GREEN
 * while it's beating, AMBER once beats go quiet for 90s. It rests at ~60bpm,
 * throws a strong pulse whenever a new beat arrives (`lastBeatIso` changing), and
 * slows when quiet. The one element on the board that's deliberately human.
 */
export function AnimatedHeart({ lastBeatIso, size = 14, title, stallSeconds = STALL_SECONDS }: Props) {
  const now = useNow(1000);
  const overdue = !!lastBeatIso && (secondsSince(lastBeatIso, now) ?? 0) > stallSeconds;

  const [pulsing, setPulsing] = useState(false);
  const prev = useRef<string | undefined>(undefined);
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;
      prev.current = lastBeatIso;
      return; // don't pulse on first mount
    }
    if (lastBeatIso && lastBeatIso !== prev.current) {
      prev.current = lastBeatIso;
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), 470);
      return () => clearTimeout(t);
    }
  }, [lastBeatIso]);

  const cls = pulsing ? "heart-strong" : overdue ? "heart-weak" : "heart-rest";

  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color: overdue ? "var(--color-amber)" : "var(--color-mint)" }}
      aria-label={title ?? "heartbeat"}
    >
      <title>{title ?? (overdue ? "beats have gone quiet" : "heartbeat")}</title>
      <path
        fill="currentColor"
        d="M12 21s-7.5-4.7-10-9.2C.4 8.4 2 5 5.2 5c2 0 3.3 1.1 4.1 2.3l.9 1.3.9-1.3C11.9 6.1 13.2 5 15.2 5 18.4 5 20 8.4 18.5 11.8 16 16.3 12 21 12 21Z"
      />
    </svg>
  );
}
