import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SectionHead, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { CodeBlock } from "../components/CodeBlock";
import { Icon } from "../components/Icon";
import { EXAMPLES } from "../data/examples";

const GH = "https://github.com/mettafive/agent-conductor/blob/main/examples";

export function ExamplesPage() {
  const [open, setOpen] = useState<string | null>(EXAMPLES[0]?.id ?? null);

  return (
    <Page>
      <SectionHead
        kicker="Examples"
        title="Patterns to steal from"
        sub="From a linear pipeline to a gated review with branches and loops."
      />

      <div className="mx-auto mt-12 max-w-5xl space-y-3">
        {EXAMPLES.map((ex) => {
          const isOpen = open === ex.id;
          return (
            <Reveal key={ex.id}>
              <div className="overflow-hidden rounded-2xl border border-line bg-panel/40">
                <button
                  onClick={() => setOpen(isOpen ? null : ex.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left"
                >
                  <span className="text-dim transition-transform duration-200" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>
                    <Icon name="chevronRight" size={14} />
                  </span>
                  <span className="font-mono text-sm text-chalk">{ex.name}</span>
                  <span className="rounded-md border border-line-2 px-2 py-0.5 font-mono text-[10px] text-mist">
                    {ex.pattern}
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-sm text-mist sm:block">
                    {ex.tagline}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-line px-5 py-4">
                        <p className="mb-3 text-sm leading-relaxed text-mist-2 sm:hidden">{ex.tagline}</p>
                        <CodeBlock code={ex.yaml} filename={`${ex.id}.yaml`} lang="yaml" />
                        <a
                          href={`${GH}/${ex.id}.yaml`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-mist transition-colors hover:text-chalk"
                        >
                          view on GitHub <span aria-hidden>↗</span>
                        </a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Page>
  );
}
