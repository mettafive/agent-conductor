// One identity, one display scheme.
//
// IDENTITY is the canonical outer server-discovery key (the useBoardState map key /
// App.activeWf), e.g. "landing-forge" or its lifecycle variant "landing-forge (compile)".
// DISPLAY is the base workflow name + a phase badge. The inner JSON title
// (status.workflow / workflow-JSON name) is NEVER shown as identity — that's what leaks
// "Migrating skill to conductor" into the header. Every surface points at these helpers.

const LIFECYCLE_SUFFIX = /\s*\((compile|integration)\)\s*$/;

/** The base workflow name: the canonical key with any lifecycle suffix stripped.
 *  "landing-forge (compile)" → "landing-forge"; "landing-forge" → "landing-forge". */
export function displayName(key: string | null | undefined): string {
  return String(key ?? "").replace(LIFECYCLE_SUFFIX, "").trim() || "workflow";
}

/** The lifecycle phase a key encodes, or null for a plain run feed. */
export function lifecyclePhase(key: string | null | undefined): "compile" | "integration" | null {
  const m = String(key ?? "").match(LIFECYCLE_SUFFIX);
  return m ? (m[1] as "compile" | "integration") : null;
}

/** True for a lifecycle (compile/integration) feed — there is no dispatch loop to
 *  drain on these, so pause is a no-op. */
export function isLifecycle(key: string | null | undefined): boolean {
  return LIFECYCLE_SUFFIX.test(String(key ?? ""));
}

/** The human phase label shown beside the base name. Lifecycle keys read their phase
 *  ("Compiling" / "Improving"); a run feed reads its overall status. */
export function phaseLabel(key: string | null | undefined, overallStatus?: string): string {
  const lc = lifecyclePhase(key);
  if (lc === "compile") return "Compiling";
  if (lc === "integration") return "Improving";
  switch (overallStatus) {
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "idle":
    case undefined:
    case "":
      return "Pending";
    default:
      return overallStatus.charAt(0).toUpperCase() + overallStatus.slice(1);
  }
}
