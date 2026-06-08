import { AnimatePresence, motion } from "framer-motion";
import type { KnowledgeEntry } from "../lib/types";
import { InsightsDashboard } from "./InsightsDashboard";

export function InsightsModal({
  open,
  onClose,
  workflow,
  knowledge,
  runCount,
  currentRunId,
}: {
  open: boolean;
  onClose: () => void;
  workflow: string;
  knowledge: KnowledgeEntry[];
  runCount: number;
  currentRunId?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={onClose}
          className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-[min(1040px,94vw)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-dim">Insights</div>
                <div className="mt-1 truncate text-[15px] font-medium text-chalk">{workflow}</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-line px-3 py-1.5 font-mono text-[12px] text-mist transition-colors hover:border-line-2 hover:text-chalk"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <InsightsDashboard workflow={workflow} knowledge={knowledge} runCount={runCount} currentRunId={currentRunId} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
