import { describe, expect, it } from "vitest";
import {
  BOARD_RECOVERY_WITHOUT_RESPONDER_EXHAUSTED_REASON,
  DEFAULT_BOARD_RECOVERY_WITHOUT_RESPONDER_MAX_ATTEMPTS,
  buildBoardRecoveryWithoutResponderBudget,
  decideBoardRecoveryRetryCeiling,
  isBoardRecoveryBudgetExhausted,
} from "./board-recovery-retry-ceiling.js";

describe("decideBoardRecoveryRetryCeiling (R5)", () => {
  it("ignores non-board owners", () => {
    expect(
      decideBoardRecoveryRetryCeiling({
        ownerType: "agent",
        hasNamedHumanResponder: false,
      }),
    ).toBeNull();
  });

  it("preserves current behavior when a human responder is already named", () => {
    expect(
      decideBoardRecoveryRetryCeiling({
        ownerType: "board",
        hasNamedHumanResponder: true,
      }),
    ).toEqual({
      kind: "preserve_human_loop",
      reason: "pending_interaction_or_approval",
    });
  });

  it("applies an immediate retry ceiling when board has no named responder", () => {
    expect(
      decideBoardRecoveryRetryCeiling({
        ownerType: "board",
        hasNamedHumanResponder: false,
      }),
    ).toEqual({
      kind: "apply_ceiling",
      maxAttempts: DEFAULT_BOARD_RECOVERY_WITHOUT_RESPONDER_MAX_ATTEMPTS,
      exhaustImmediately: true,
      reason: BOARD_RECOVERY_WITHOUT_RESPONDER_EXHAUSTED_REASON,
    });
  });

  it("honors an explicit positive maxAttempts override", () => {
    expect(
      decideBoardRecoveryRetryCeiling({
        ownerType: "board",
        hasNamedHumanResponder: false,
        maxAttempts: 3,
      }),
    ).toMatchObject({ kind: "apply_ceiling", maxAttempts: 3 });
  });
});

describe("board recovery budget helpers (R5)", () => {
  it("detects exhausted recoveryBudget evidence", () => {
    expect(isBoardRecoveryBudgetExhausted(undefined)).toBe(false);
    expect(
      isBoardRecoveryBudgetExhausted({
        recoveryBudget: { state: "exhausted" },
      }),
    ).toBe(true);
    expect(
      isBoardRecoveryBudgetExhausted({
        recoveryBudget: { state: "open" },
      }),
    ).toBe(false);
  });

  it("builds inspectable exhaust evidence (never silence)", () => {
    const budget = buildBoardRecoveryWithoutResponderBudget({
      attemptsUsed: 1,
      maxAttempts: 1,
      cause: "deliberate_wait_without_target",
      fingerprint: "fp-1",
      exhaustedAt: "2026-10-15T19:00:00.000Z",
    });
    expect(budget).toEqual({
      state: "exhausted",
      attemptsUsed: 1,
      maxAttempts: 1,
      exhaustedAt: "2026-10-15T19:00:00.000Z",
      cause: "deliberate_wait_without_target",
      fingerprint: "fp-1",
      reason: BOARD_RECOVERY_WITHOUT_RESPONDER_EXHAUSTED_REASON,
    });
  });
});
