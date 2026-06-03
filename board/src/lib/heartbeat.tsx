import type { ReactNode } from "react";

const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Render a heartbeat note, turning [text](url) into styled external links. */
export function renderNote(note: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK.lastIndex = 0;
  let i = 0;
  while ((m = LINK.exec(note)) !== null) {
    if (m.index > last) out.push(note.slice(last, m.index));
    out.push(
      <a
        key={i++}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-cyan underline-offset-2 hover:underline"
      >
        {m[1]}
        <span aria-hidden className="ml-0.5 text-[0.85em]">
          ↗
        </span>
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < note.length) out.push(note.slice(last));
  return out;
}

/** Seconds between an ISO timestamp and `now` (ms). */
export function secondsSince(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 1000));
}

/** "45s ago" / "2m ago" / "1h ago". */
export function relativeTime(iso: string | undefined, now: number): string {
  const s = secondsSince(iso, now);
  if (s === null) return "";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
