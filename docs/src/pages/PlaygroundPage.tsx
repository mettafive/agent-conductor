import { SectionHead, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { Playground } from "../components/Playground";

const LEGEND = [
  { k: "Step", d: "A unit of work with a gate that must pass." },
  { k: "Condition", d: "Branches the flow on if_true / if_false." },
  { k: "Loop", d: "Runs the same gated sub-steps over a list." },
  { k: "Edges", d: "requires dashes in; then rejoins a branch." },
];

export function PlaygroundPage() {
  return (
    <Page>
      <SectionHead
        kicker="Playground"
        title="See a workflow before you run it"
        sub="Edit the conductor YAML; the flow graph redraws as you type."
      />

      <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-relaxed text-mist">
        The same parser that drives the board turns a conductor into a graph — so you
        can sketch a workflow, catch a missing dependency or a dead branch, and hand
        the agent something sound. Pick an example or paste your own.
      </p>

      <Reveal className="mx-auto mt-10 max-w-5xl">
        <Playground />
      </Reveal>

      <div className="mx-auto mt-6 grid max-w-5xl gap-3 sm:grid-cols-4">
        {LEGEND.map((l) => (
          <Reveal key={l.k} className="h-full">
            <div className="flex h-full flex-col rounded-xl border border-line bg-panel/30 p-4">
              <div className="font-mono text-[13px] font-medium text-chalk">{l.k}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{l.d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Page>
  );
}
