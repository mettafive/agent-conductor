import { useState } from "react";
import { EXAMPLES } from "../data/examples";
import { FlowDiagram } from "./FlowDiagram";

export function Playground() {
  const [active, setActive] = useState(EXAMPLES[1].id); // treatment-page shows a branch
  const [yaml, setYaml] = useState(EXAMPLES[1].yaml);
  const [dirty, setDirty] = useState(false);

  const select = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setActive(id);
    setYaml(ex.yaml);
    setDirty(false);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-2/60 shadow-2xl backdrop-blur">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            onClick={() => select(ex.id)}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs transition-colors ${
              active === ex.id && !dirty
                ? "bg-iris/15 text-iris"
                : "text-mist hover:bg-panel hover:text-chalk"
            }`}
          >
            {ex.name}
          </button>
        ))}
        <span className="ml-auto hidden items-center gap-1.5 font-mono text-[11px] text-mist sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          {dirty ? "editing — live" : "edit the YAML →"}
        </span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,42%)_minmax(0,58%)]">
        <div className="border-b border-line lg:border-b-0 lg:border-r">
          <textarea
            spellCheck={false}
            value={yaml}
            onChange={(e) => {
              setYaml(e.target.value);
              setDirty(true);
            }}
            className="h-[340px] w-full resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-mist-2 outline-none lg:h-[520px]"
          />
        </div>
        <div className="h-[340px] bg-ink-2 lg:h-[520px]">
          <FlowDiagram yaml={yaml} />
        </div>
      </div>
    </div>
  );
}
