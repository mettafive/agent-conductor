import { Mark } from "./Mark";

const BASE = import.meta.env.BASE_URL;

const LINKS = [
  { label: "Board", href: `${BASE}#/board` },
  { label: "Spec", href: `${BASE}#/spec` },
  { label: "Playground", href: `${BASE}#/playground` },
  { label: "Examples", href: `${BASE}#/examples` },
  { label: "Docs", href: `${BASE}kanban.html` },
];

/** A clean navigation footer, shared by every page. */
export function FooterNav() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto max-w-5xl px-5 py-10">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-between">
          <a
            href={`${BASE}#/`}
            className="flex items-center gap-2 text-mist transition-colors hover:text-chalk"
          >
            <Mark size={18} />
            <span className="font-mono text-sm">agent-conductor</span>
          </a>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px]">
            {LINKS.map((l) => (
              <a key={l.label} href={l.href} className="text-mist transition-colors hover:text-chalk">
                {l.label}
              </a>
            ))}
            <a
              href="https://github.com/mettafive/agent-conductor"
              target="_blank"
              rel="noreferrer"
              className="text-mist transition-colors hover:text-chalk"
            >
              GitHub ↗
            </a>
          </nav>
        </div>
        <div className="mt-7 border-t border-line pt-5 text-center font-mono text-[11px] text-dim">
          MIT © mettafive · built to be conducted
        </div>
      </div>
    </footer>
  );
}
