const LINKS = [
  { href: "#spec", label: "Spec" },
  { href: "#playground", label: "Playground" },
  { href: "#examples", label: "Examples" },
  { href: "#board", label: "Board" },
  { href: "#heartbeats", label: "Heartbeats" },
  { href: "#agents", label: "For agents" },
];

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line/70 bg-ink/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5">
          <img src="/agent-conductor/conductor.svg" alt="" className="h-7 w-7" />
          <span className="font-mono text-sm font-medium tracking-tight text-chalk">
            agent-conductor
          </span>
          <span className="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-mist">
            v1.0.0
          </span>
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm text-mist transition-colors hover:text-chalk"
            >
              {l.label}
            </a>
          ))}
          <a
            href="https://github.com/mettafive/agent-conductor"
            target="_blank"
            rel="noreferrer"
            className="ml-2 flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm text-chalk transition-colors hover:border-iris/50 hover:bg-panel-2"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Star
          </a>
        </div>
      </nav>
    </header>
  );
}
