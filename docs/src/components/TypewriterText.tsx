import { useEffect, useState } from "react";

interface Props {
  text: string;
  /** Milliseconds per character (base). The demo streams agent-fast. */
  speed?: number;
  className?: string;
  cursor?: boolean;
  onDone?: () => void;
}

/**
 * Streams `text` in character by character. Fast — like an agent, not a person
 * — but with a touch of variance so it doesn't feel mechanical. No long human
 * pauses; this is a demo and we want it to finish quickly and read clean.
 */
export function TypewriterText({ text, speed = 12, className, cursor = true, onDone }: Props) {
  const [n, setN] = useState(0);

  useEffect(() => {
    setN(0);
    if (!text) {
      onDone?.();
      return;
    }
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
      let delay = speed * (0.8 + Math.random() * 0.45); // tight jitter, ~0.8–1.25×
      if (last === "." || last === "!" || last === "?") delay += 55;
      else if (last === "," || last === ";" || last === ":") delay += 28;
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, speed);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, speed]);

  const typing = n < text.length;
  return (
    <span className={className}>
      {text.slice(0, n)}
      {cursor && typing && <span className="tw-cursor text-mist">▌</span>}
    </span>
  );
}
