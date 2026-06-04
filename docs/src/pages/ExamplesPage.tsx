import { SectionHead, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { EXAMPLES } from "../data/examples";

export function ExamplesPage() {
  return (
    <Page>
      <SectionHead
        kicker="Examples"
        title="Patterns to steal from"
        sub="From a simple linear pipeline to a gates-heavy review with a security branch and a per-item loop."
      />
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {EXAMPLES.map((ex) => (
          <Reveal key={ex.id}>
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-panel/40">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <span className="font-mono text-sm text-chalk">{ex.name}</span>
                <span className="rounded-md border border-line-2 px-2 py-0.5 font-mono text-[10px] text-mist">
                  {ex.pattern}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-5">
                <p className="flex-1 text-sm leading-relaxed text-mist-2">{ex.tagline}</p>
                <a
                  href={`https://github.com/mettafive/agent-conductor/blob/main/examples/${ex.id}.yaml`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-mist transition-colors hover:text-chalk"
                >
                  view source <span aria-hidden>↗</span>
                </a>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Page>
  );
}
