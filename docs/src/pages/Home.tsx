import { Link } from "react-router-dom";
import { Eyebrow, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { LiveBoard } from "../components/LiveBoard";

export function Home() {
  return (
    <Page>
      <section className="flex flex-col items-center py-10 text-center lg:py-16">
        <Eyebrow>
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          open source · MIT · zero-dependency spec
        </Eyebrow>
        <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-chalk sm:text-6xl">
          Conduct your agents.
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-lg leading-relaxed text-mist-2">
          Gated steps any agent can follow — and a live board that watches it work.
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
    </Page>
  );
}
