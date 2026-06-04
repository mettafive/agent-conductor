import { useEffect, useState } from "react";

/**
 * The beating heart — same animation as the board. Rests at ~60bpm (heart-rest);
 * throw a fresh `beat` value to make it pulse strong. Omit `beat` for a steady
 * resting beat (e.g. a brand mark).
 */
export function Heart({ size = 14, beat }: { size?: number; beat?: number }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (beat === undefined) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 420);
    return () => clearTimeout(t);
  }, [beat]);
  return (
    <svg
      className={pulse ? "heart-strong" : "heart-rest"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color: "var(--color-heart)" }}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M12 21s-7.5-4.7-10-9.2C.4 8.4 2 5 5.2 5c2 0 3.3 1.1 4.1 2.3l.9 1.3.9-1.3C11.9 6.1 13.2 5 15.2 5 18.4 5 20 8.4 18.5 11.8 16 16.3 12 21 12 21Z"
      />
    </svg>
  );
}
