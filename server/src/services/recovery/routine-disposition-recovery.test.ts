import { describe, expect, it } from "vitest";
import {
  isRoutineDispositionFalsePositiveDoneResolution,
  isRoutineDispositionRecovery,
  recoveryBlockedOutcomeRequiresFirstClassBlocker,
} from "./routine-disposition-recovery.js";

describe("routine-disposition-recovery (R4 / AGL-241 / CTO AGL-651)", () => {
  it("recognizes disposition kinds on routine_execution", () => {
    expect(
      isRoutineDispositionRecovery({
        kind: "deliberate_wait_without_target",
        cause: "deliberate_wait_without_target",
        sourceOriginKind: "routine_execution",
      }),
    ).toBe(true);
    expect(
      isRoutineDispositionRecovery({
        kind: "missing_disposition",
        cause: "successful_run_missing_issue_disposition",
        sourceOriginKind: "routine_execution",
      }),
    ).toBe(true);
  });

  it("rejects non-routine or non-disposition recoveries", () => {
    expect(
      isRoutineDispositionRecovery({
        kind: "deliberate_wait_without_target",
        sourceOriginKind: "manual",
      }),
    ).toBe(false);
    expect(
      isRoutineDispositionRecovery({
        kind: "issue_graph_liveness",
        cause: "issue_graph_liveness",
        sourceOriginKind: "routine_execution",
      }),
    ).toBe(false);
  });

  it("names the false_positive → done carve-out only", () => {
    expect(
      isRoutineDispositionFalsePositiveDoneResolution({
        kind: "deliberate_wait_without_target",
        cause: "deliberate_wait_without_target",
        sourceOriginKind: "routine_execution",
        outcome: "false_positive",
        sourceIssueStatus: "done",
      }),
    ).toBe(true);
    expect(
      isRoutineDispositionFalsePositiveDoneResolution({
        kind: "deliberate_wait_without_target",
        cause: "deliberate_wait_without_target",
        sourceOriginKind: "routine_execution",
        outcome: "blocked",
        sourceIssueStatus: "blocked",
      }),
    ).toBe(false);
  });

  it("keeps first-class blocker requirement for outcome blocked", () => {
    expect(recoveryBlockedOutcomeRequiresFirstClassBlocker("blocked")).toBe(true);
    expect(recoveryBlockedOutcomeRequiresFirstClassBlocker("false_positive")).toBe(false);
    expect(recoveryBlockedOutcomeRequiresFirstClassBlocker("restored")).toBe(false);
  });
});
