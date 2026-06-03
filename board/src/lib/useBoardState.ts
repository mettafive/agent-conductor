import { useEffect, useState } from "react";
import { buildModel } from "./merge";
import type { BoardModel, HistoryRun, Snapshot } from "./types";

type Conn = "connecting" | "live" | "lost";

const EMPTY: Snapshot = {
  status: null,
  conductorYaml: null,
  statusPath: ".conductor/status.json",
  conductorPath: null,
};

interface BoardState {
  model: BoardModel;
  snap: Snapshot;
  conn: Conn;
  history: HistoryRun[];
}

/** Subscribes to the server's SSE stream: live status + archived history. */
export function useBoardState(): BoardState {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      es = new EventSource("/events");
      es.addEventListener("open", () => setConn("live"));
      es.addEventListener("update", (e) => {
        try {
          setSnap(JSON.parse((e as MessageEvent).data) as Snapshot);
          setConn("live");
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener("history", (e) => {
        try {
          setHistory(JSON.parse((e as MessageEvent).data) as HistoryRun[]);
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

  return { model: buildModel(snap), snap, conn, history };
}
