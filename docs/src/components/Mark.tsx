/** Simplified olive sprig in currentColor — the footer mark (no tile). */
export function Mark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path
        d="M7 25 C 13 21, 16 13, 25 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <g fill="currentColor">
        <path d="M-3.4 0 C -1.7 -2 1.7 -2 3.4 0 C 1.7 2 -1.7 2 -3.4 0 Z" transform="translate(26,6) rotate(-58)" />
        <path d="M-3 0 C -1.5 -1.8 1.5 -1.8 3 0 C 1.5 1.8 -1.5 1.8 -3 0 Z" transform="translate(20,12) rotate(-50)" />
        <path d="M-3 0 C -1.5 -1.8 1.5 -1.8 3 0 C 1.5 1.8 -1.5 1.8 -3 0 Z" transform="translate(17,16) rotate(34)" />
        <circle cx="14.5" cy="14" r="1.7" />
      </g>
    </svg>
  );
}
