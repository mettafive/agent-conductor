import type { ReactNode } from "react";
import { useReveal } from "../lib/useReveal";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/60 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-mist">
      {children}
    </span>
  );
}

export function SectionHead({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal mx-auto max-w-2xl text-center">
      <Eyebrow>{kicker}</Eyebrow>
      <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-chalk sm:text-4xl">
        {title}
      </h2>
      {sub && <p className="mt-3 text-pretty text-mist-2">{sub}</p>}
    </div>
  );
}

/** Standard page wrapper — centers content and gives a consistent gutter. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-5 pb-24 pt-10">{children}</div>;
}
