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
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) {
        clearInterval(id);
        onDone?.();
      }
    }, speed);
    return () => clearInterval(id);
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
