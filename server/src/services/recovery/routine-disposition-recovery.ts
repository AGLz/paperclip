/**
 * R4 (AGL-241 / CTO decision AGL-651): disposition recoveries on
 * `routine_execution` resolve by choosing a disposition — typically
 * `false_positive` + `sourceIssueStatus: done` — without inventing a
 * first-class blocker the routine never had.
 *
 * Security boundary: `outcome: "blocked"` still always requires an unresolved
 * first-class blocker. This module only names the disposition carve-out.
 */

const DISPOSITION_RECOVERY_KINDS = new Set([
  "missing_disposition",
  "deliberate_wait_without_target",
]);

const DISPOSITION_RECOVERY_CAUSES = new Set([
  "missing_disposition",
  "deliberate_wait_without_target",
  "successful_run_missing_issue_disposition",
]);

export function isRoutineDispositionRecovery(input: {
  kind?: string | null;
  cause?: string | null;
  sourceOriginKind?: string | null;
}): boolean {
  if (input.sourceOriginKind !== "routine_execution") return false;
  const kind = input.kind ?? "";
  const cause = input.cause ?? "";
  return DISPOSITION_RECOVERY_KINDS.has(kind) || DISPOSITION_RECOVERY_CAUSES.has(cause);
}

/**
 * True when a recovery resolution is the R4 cleanup path: disposition
 * recovery on a routine, cleared as false positive with terminal `done`.
 */
export function isRoutineDispositionFalsePositiveDoneResolution(input: {
  kind?: string | null;
  cause?: string | null;
  sourceOriginKind?: string | null;
  outcome?: string | null;
  sourceIssueStatus?: string | null;
}): boolean {
  if (input.outcome !== "false_positive") return false;
  if (input.sourceIssueStatus !== "done") return false;
  return isRoutineDispositionRecovery(input);
}

/**
 * Whether resolving with `outcome: "blocked"` must attach an unresolved
 * first-class blocker. Always true for that outcome — R4 does not weaken it.
 */
export function recoveryBlockedOutcomeRequiresFirstClassBlocker(outcome: string): boolean {
  return outcome === "blocked";
}
