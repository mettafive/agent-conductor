// A standalone status writer process — the concurrency test spawns N of these to
// prove the cross-process lock serializes appends with no lost updates.
// usage: node _status-writer.mjs <statusPath> <writerId> <beatCount>
import { mutateStatus, stampBeat } from "../cli/status-store.js";

const [, , sp, id, countStr] = process.argv;
const count = Number(countStr) || 0;
for (let i = 0; i < count; i++) {
  mutateStatus(sp, (s) => {
    if (!s) return null;
    s.steps = s.steps || {};
    const cell = (s.steps["0"] = s.steps["0"] || { heartbeat: [] });
    cell.heartbeat = Array.isArray(cell.heartbeat) ? cell.heartbeat : [];
    cell.heartbeat.push(stampBeat(s, { at: new Date().toISOString(), note: `w${id}-${i}` }));
    s[`field_${id}`] = id; // each writer owns its own status field — must never be clobbered
  });
}
