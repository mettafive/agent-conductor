import { useEffect, useState } from "react";
import type { HistoryRun, InsightLedger, Snapshot } from "./types";

type Conn = "connecting" | "live" | "lost";

const EMPTY: Snapshot = {
  status: null,
  workflowJson: null,
  statusPath: ".conductor/status.json",
  conductorPath: null,
};

export interface WorkflowEntry {
  snap: Snapshot;
  history: HistoryRun[];
  ledger?: InsightLedger;
}

interface BoardState {
  workflows: Record<string, WorkflowEntry>;
  order: string[];
  conn: Conn;
}

/**
 * Subscribes to the server's SSE stream. Events are tagged with a `workflow`
 * name, so state is kept as a map of workflow → { live snapshot, history }.
 */
export function useBoardState(): BoardState {
  const [workflows, setWorkflows] = useState<Record<string, WorkflowEntry>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;

    const remember = (name: string) =>
      setOrder((prev) => (prev.includes(name) ? prev : [...prev, name]));

    const connect = () => {
      es = new EventSource("/events");
      es.addEventListener("open", () => setConn("live"));

      es.addEventListener("update", (e) => {
        try {
          const snap = JSON.parse((e as MessageEvent).data) as Snapshot & {
            workflow?: string;
          };
          const name = snap.workflow ?? "workflow";
          remember(name);
          setWorkflows((prev) => ({
            ...prev,
            [name]: { snap, history: prev[name]?.history ?? [] },
          }));
          setConn("live");
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("history", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data);
          if (Array.isArray(d)) return; // legacy untagged format — ignore
          const name = d.workflow as string;
          const runs = (d.runs ?? []) as HistoryRun[];
          remember(name);
          setWorkflows((prev) => ({
            ...prev,
            [name]: {
              snap: prev[name]?.snap ?? EMPTY,
              history: runs,
              ledger: prev[name]?.ledger,
            },
          }));
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("insights", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data);
          const name = d.workflow as string;
          const ledger = d.ledger as InsightLedger;
          remember(name);
          setWorkflows((prev) => ({
            ...prev,
            [name]: {
              snap: prev[name]?.snap ?? EMPTY,
              history: prev[name]?.history ?? [],
              ledger,
            },
          }));
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("error", () => {
        setConn("lost");
        es?.close();
        clearTimeout(retry);
        retry = setTimeout(connect, 2000);
      });
    };
    connect();

    return () => {
      es?.close();
      clearTimeout(retry);
    };
  }, []);

  return { workflows, order, conn };
}

export { EMPTY };
