import { useEffect, useRef, useState } from "react";

interface Props {
  text: string;
  /** Milliseconds per character. Constant — teletype, no easing. */
  speed?: number;
  /** Catch-up mode: type the SAME humanised way, just much faster, so a beat that
   *  has a newer beat queued behind it finishes quickly without snapping. Read live
   *  via a ref, so flipping it mid-line speeds up the rest WITHOUT restarting. */
  fast?: boolean;
  className?: string;
  /** Show the block cursor while typing (and hide it when done). */
  cursor?: boolean;
  onDone?: () => void;
}

/**
 * Types `text` in character by character at a constant speed, like a teletype.
 * A block cursor (█) sits at the typing position and disappears once the line
 * completes. Re-streams from the start whenever `text` changes.
 */
export function TypewriterText({ text, speed = 30, fast = false, className, cursor = true, onDone }: Props) {
  const [n, setN] = useState(0);
  // Live catch-up flag — read inside the step loop so flipping `fast` mid-line
  // speeds up the remaining characters without restarting (deps don't include it).
  const fastRef = useRef(fast);
  fastRef.current = fast;

  useEffect(() => {
    setN(0);
    if (!text) {
      onDone?.();
      return;
    }
    // A touch faster than a metronome (base 25% quicker), but humanised: each
    // letter's gap jitters slightly, and there's a barely-there breath after
    // sentence and clause punctuation. The pauses claw back most of the speed-up
    // (~10% faster overall) while making it feel typed, not played back.
    const base = speed * 0.62; // ~20% quicker than before
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      i += 1;
      setN(i);
      if (i >= text.length) {
        onDone?.();
        return;
      }
      const last = text[i - 1];
      // Catch-up: same humanised shape, ~9× faster, with the breaths trimmed and
      // the think-pause dropped — so you still see every character fly past.
      const f = fastRef.current;
      const rate = f ? base * 0.11 : base;
      const pause = f ? 0.08 : 1;
      // Uneven pace — some letters tumble out, others lag. Real breaths after
      // sentence/clause punctuation, and the odd hesitation mid-thought.
      let delay = rate * (0.45 + Math.random() * 1.25); // ~0.45–1.7×
      if (last === "." || last === "!" || last === "?") delay += 190 * pause;
      else if (last === "," || last === ";" || last === ":") delay += 88 * pause;
      else if (last === " ") delay += 18 * pause;
      if (!f && Math.random() < 0.06) delay += 96 + Math.random() * 128; // a brief pause to think
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, fastRef.current ? base * 0.11 : base);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, speed]);

  const typing = n < text.length;

  return (
    <span className={className}>
      {text.slice(0, n)}
      {cursor && typing && <span className="tw-cursor text-cyan">█</span>}
    </span>
  );
}
