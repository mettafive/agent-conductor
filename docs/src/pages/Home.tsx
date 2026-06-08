import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { LiveBoard } from "../components/LiveBoard";
import { Heart } from "../components/Heart";
import { Icon } from "../components/Icon";

function Pillar({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/50 px-3.5 py-1.5 text-[12.5px] text-mist-2">
      <span className="text-mist">{icon}</span>
      {label}
    </span>
  );
}

export function Home() {
  return (
    <Page>
      <section className="flex flex-col items-center py-10 text-center lg:py-14">
        {/* three pillars instead of a tagline eyebrow */}
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Pillar icon={<Icon name="check" size={14} />} label="Verified cards" />
          <Pillar icon={<Heart size={14} />} label="Live updates" />
          <Pillar icon={<Icon name="loop" size={14} />} label="Self-improving" />
        </div>

        <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-chalk sm:text-6xl">
          Conduct your agents.
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-lg leading-relaxed text-mist-2">
          Every card is checked against its own instruction — and a live board
          you read like a story and steer as it works.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/board"
            className="rounded-xl bg-chalk px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-white"
          >
            See the board
          </Link>
          <Link
            to="/spec"
            className="rounded-xl border border-line-2 bg-panel/60 px-5 py-3 text-sm text-chalk transition-colors hover:bg-panel"
          >
            Read the spec
          </Link>
        </div>
        <div className="mt-6 flex items-center gap-2 font-mono text-sm text-mist">
          <span className="text-dim">$</span>
          <span className="text-mist-2">npx conductor-board</span>
          <span className="h-4 w-px animate-pulse bg-mist" />
        </div>

        <Reveal className="mt-12 w-full max-w-3xl">
          <LiveBoard />
        </Reveal>
      </section>

      {/* simpler problem / solution, right under the hero */}
      <section className="grid gap-4 pb-6 md:grid-cols-2">
        <Reveal className="h-full">
          <div className="flex h-full items-start gap-3 rounded-2xl border border-line bg-panel/40 p-5">
            <span className="mt-1 shrink-0 text-rose">
              <Icon name="cross" size={15} />
            </span>
            <p className="text-pretty text-sm leading-relaxed text-mist-2">
              <span className="font-medium text-chalk">The problem.</span> Hand an
              agent twelve steps and it skips half of them — declaring a half-finished
              thing done.
            </p>
          </div>
        </Reveal>
        <Reveal className="h-full">
          <div className="flex h-full items-start gap-3 rounded-2xl border border-line bg-panel/40 p-5">
            <span className="mt-1 shrink-0 text-mint">
              <Icon name="check" size={15} />
            </span>
            <p className="text-pretty text-sm leading-relaxed text-mist-2">
              <span className="font-medium text-chalk">The solution.</span> Verified
              cards, watched live. Fail a check and the agent retries — it never skips.
            </p>
          </div>
        </Reveal>
      </section>

      {/* what the checks and the board actually guarantee */}
      <section className="grid gap-4 pb-10 md:grid-cols-3">
        {[
          {
            icon: "check" as const,
            title: "Verified against instructions",
            body: "Every card is independently verified against its own instruction. Better instructions give the checker a sharper target.",
          },
          {
            icon: "loop" as const,
            title: "Nothing gets skipped",
            body: "A loop can't close while any planned iteration is incomplete; every failed check forces fix-and-retry. Coverage is structural.",
          },
          {
            icon: "clock" as const,
            title: "A run you steer",
            body: "Codex-style updates read like a story: what the agent learned, decided, changed, or handed off. Comments become directives the next run must apply — or defer with a reason.",
          },
        ].map((f) => (
          <Reveal key={f.title} className="h-full">
            <div className="flex h-full flex-col gap-2 rounded-2xl border border-line bg-panel/40 p-5">
              <span className="flex items-center gap-2 text-chalk">
                <span className="text-mist">
                  <Icon name={f.icon} size={15} />
                </span>
                <span className="text-sm font-medium">{f.title}</span>
              </span>
              <p className="text-pretty text-sm leading-relaxed text-mist-2">{f.body}</p>
            </div>
          </Reveal>
        ))}
      </section>
    </Page>
  );
}
