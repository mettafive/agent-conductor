import { useEffect, useRef, useState } from "react";
import { buildModel } from "./merge";
import type { BoardModel, Snapshot } from "./types";

type Conn = "connecting" | "live" | "lost";

const EMPTY: Snapshot = {
  status: null,
  conductorYaml: null,
  statusPath: ".conductor/status.json",
  conductorPath: null,
};

/** Subscribes to the server's SSE stream and rebuilds the board model on each push. */
export function useBoardState(): { model: BoardModel; snap: Snapshot; conn: Conn } {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [conn, setConn] = useState<Conn>("connecting");
  const modelRef = useRef<BoardModel>(buildModel(EMPTY));

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

  const model = buildModel(snap);
  modelRef.current = model;
  return { model, snap, conn };
}
