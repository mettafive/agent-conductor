import { Link } from "react-router-dom";
import { Eyebrow, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { LiveBoard } from "../components/LiveBoard";
import { Icon } from "../components/Icon";

export function Home() {
  return (
    <Page>
      {/* hero */}
      <section className="grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-20">
        <div>
          <Eyebrow>
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            open source · MIT · zero-dependency spec
          </Eyebrow>
          <h1 className="mt-5 text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-chalk sm:text-6xl">
            Stop agents from <span className="text-mist">skipping steps.</span>
          </h1>
          <p className="mt-5 max-w-lg text-pretty text-lg leading-relaxed text-mist-2">
            A portable spec and a live local Kanban board for orchestrating AI agent
            workflows with <span className="text-chalk">gated steps</span>. Each step
            must clear its gate before the next unlocks.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/board"
              className="rounded-xl bg-chalk px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-white"
            >
              See the board
            </Link>
            <Link
              to="/spec"
              className="rounded-xl border border-line-2 bg-panel/60 px-5 py-3 text-sm text-chalk transition-colors hover:border-line-2 hover:bg-panel"
            >
              Read the spec
            </Link>
          </div>
          <div className="mt-7 flex items-center gap-2 font-mono text-sm text-mist">
            <span className="text-dim">$</span>
            <span className="text-mist-2">npx conductor-board</span>
            <span className="h-4 w-px animate-pulse bg-mist" />
          </div>
        </div>

        <Reveal>
          <LiveBoard />
        </Reveal>
      </section>

      {/* problem / solution */}
      <section className="py-12">
        <div className="grid gap-5 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-line bg-panel/40 p-7">
              <div className="mb-4 inline-grid h-9 w-9 place-items-center rounded-lg border border-rose/30 bg-rose/10 text-rose">
                <Icon name="cross" size={16} />
              </div>
              <h3 className="text-lg font-semibold text-chalk">The problem</h3>
              <p className="mt-2 text-pretty leading-relaxed text-mist-2">
                You hand an agent twelve steps and hope. Around step seven it decides
                the rest is implied, declares victory, and hands you a half-finished
                thing that <em>looks</em> done. Long workflows rot because nothing
                forces the agent to clear each bar.
              </p>
            </div>
          </Reveal>
          <Reveal>
            <div className="h-full rounded-2xl border border-line bg-panel/40 p-7">
              <div className="mb-4 inline-grid h-9 w-9 place-items-center rounded-lg border border-mint/30 bg-mint/10 text-mint">
                <Icon name="check" size={16} />
              </div>
              <h3 className="text-lg font-semibold text-chalk">The solution</h3>
              <p className="mt-2 text-pretty leading-relaxed text-mist-2">
                Gated steps. Each step carries criteria that must all pass before the
                next unlocks. <span className="text-chalk">Soft gates</span> capture
                taste; <span className="text-chalk">hard gates</span> run real checks.
                Fail a gate and the agent retries — it never skips.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* three pillars */}
      <section className="py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { t: "Gated steps", d: "Soft + hard criteria gate every step. Nothing advances unverified." },
            { t: "Heartbeats", d: "The agent checks in as it works — re-anchoring to the goal, live on the board." },
            { t: "Self-improving", d: "The conductor is the knowledge base; proven learnings apply themselves next run." },
          ].map((f) => (
            <Reveal key={f.t}>
              <div className="h-full rounded-xl border border-line bg-panel/30 p-5">
                <div className="font-medium text-chalk">{f.t}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-mist">{f.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* cta */}
      <section className="py-12">
        <Reveal>
          <div className="overflow-hidden rounded-3xl border border-line bg-panel/40 p-10 text-center sm:p-16">
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-chalk sm:text-4xl">
              Conduct your agents.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-mist-2">
              Grab the spec, write a conductor, hand it to any agent. MIT licensed and
              community-first.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a
                href="https://github.com/mettafive/agent-conductor"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-chalk px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-white"
              >
                View on GitHub
              </a>
              <Link
                to="/spec"
                className="rounded-xl border border-line-2 bg-panel/60 px-5 py-3 text-sm text-chalk transition-colors hover:border-line-2 hover:bg-panel"
              >
                Read the full spec
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </Page>
  );
}
