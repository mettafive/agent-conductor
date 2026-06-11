import type { ReactNode } from "react";

export type IconName =
  | "check"
  | "cross"
  | "chevronRight"
  | "chevronDown"
  | "arrowLeft"
  | "arrowRight"
  | "loop"
  | "clock"
  | "menu"
  | "muted"
  | "sound"
  | "minus"
  | "pause"
  | "play";

const PATHS: Record<IconName, ReactNode> = {
  check: <path d="M4 12l5 5L20 7" />,
  cross: <path d="M6 6l12 12M18 6 6 18" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  arrowLeft: <path d="M11 6l-6 6 6 6M5 12h14" />,
  arrowRight: <path d="M13 6l6 6-6 6M19 12H5" />,
  loop: <path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4m14-1v2a4 4 0 0 1-4 4H3" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  muted: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="m23 9-6 6M17 9l6 6" />
    </>
  ),
  sound: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  pause: (
    <>
      <path d="M9 6v12" />
      <path d="M15 6v12" />
    </>
  ),
  play: <path d="M8 5v14l11-7-11-7Z" />,
};

/** Thin SVG icons — 1.5px stroke, no fill, currentColor. They inherit context. */
export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
