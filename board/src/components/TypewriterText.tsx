import { useEffect, useState } from "react";

interface Props {
  text: string;
  /** Milliseconds per character. Constant — teletype, no easing. */
  speed?: number;
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
export function TypewriterText({ text, speed = 30, className, cursor = true, onDone }: Props) {
  const [n, setN] = useState(0);

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
      // Uneven pace — some letters tumble out, others lag. Real breaths after
      // sentence/clause punctuation, and the odd hesitation mid-thought.
      let delay = base * (0.45 + Math.random() * 1.25); // ~0.45–1.7×
      if (last === "." || last === "!" || last === "?") delay += 190;
      else if (last === "," || last === ";" || last === ":") delay += 88;
      else if (last === " ") delay += 18;
      if (Math.random() < 0.06) delay += 96 + Math.random() * 128; // a brief pause to think
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, base);
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
