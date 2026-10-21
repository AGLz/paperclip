/**
 * R5 / AGL-242: board-owned recovery without a named human responder must not
 * auto-retry forever. A pending interaction or approval that names a responder
 * preserves the current wait. Without that, the action gets a retry ceiling and
 * expires with inspectable evidence instead of burning model runs every ~2 min.
 */

export const DEFAULT_BOARD_RECOVERY_WITHOUT_RESPONDER_MAX_ATTEMPTS = 1;

export const BOARD_RECOVERY_WITHOUT_RESPONDER_EXHAUSTED_REASON =
  "board_without_named_responder";

export type BoardRecoveryRetryCeilingDecision =
  | {
      kind: "preserve_human_loop";
      reason: "pending_interaction_or_approval";
    }
  | {
      kind: "apply_ceiling";
      maxAttempts: number;
      exhaustImmediately: boolean;
      reason: typeof BOARD_RECOVERY_WITHOUT_RESPONDER_EXHAUSTED_REASON;
    };

/**
 * Decide whether a board-owned recovery action may keep retrying automatically.
 *
 * - Human in the loop (pending interaction/approval) → preserve current wait.
 * - Otherwise → apply a hard ceiling and prefer immediate exhaust so the sweep
 *   cannot schedule another agent wake against the same board hold.
 */
export function decideBoardRecoveryRetryCeiling(input: {
  ownerType: string | null | undefined;
  hasNamedHumanResponder: boolean;
  maxAttempts?: number | null;
}): BoardRecoveryRetryCeilingDecision | null {
  if (input.ownerType !== "board") return null;
  if (input.hasNamedHumanResponder) {
    return {
      kind: "preserve_human_loop",
      reason: "pending_interaction_or_approval",
    };
  }
  const configured =
    typeof input.maxAttempts === "number" &&
    Number.isFinite(input.maxAttempts) &&
    input.maxAttempts > 0
      ? Math.floor(input.maxAttempts)
      : DEFAULT_BOARD_RECOVERY_WITHOUT_RESPONDER_MAX_ATTEMPTS;
  return {
    kind: "apply_ceiling",
    maxAttempts: configured,
    exhaustImmediately: true,
    reason: BOARD_RECOVERY_WITHOUT_RESPONDER_EXHAUSTED_REASON,
  };
}

export function isBoardRecoveryBudgetExhausted(
  evidence: Record<string, unknown> | null | undefined,
): boolean {
  const budget = evidence?.recoveryBudget;
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) return false;
  const state = (budget as Record<string, unknown>).state;
  return state === "exhausted";
}

export function buildBoardRecoveryWithoutResponderBudget(input: {
  attemptsUsed: number;
  maxAttempts: number;
  cause: string;
  fingerprint: string;
  exhaustedAt?: string;
}): Record<string, unknown> {
  return {
    state: "exhausted",
    attemptsUsed: input.attemptsUsed,
    maxAttempts: input.maxAttempts,
    exhaustedAt: input.exhaustedAt ?? new Date().toISOString(),
    cause: input.cause,
    fingerprint: input.fingerprint,
    reason: BOARD_RECOVERY_WITHOUT_RESPONDER_EXHAUSTED_REASON,
  };
}

export const BOARD_RECOVERY_WITHOUT_RESPONDER_EXHAUSTED_NEXT_ACTION =
  "Automatic board recovery without a named human responder exhausted its retry ceiling. " +
  "Open an explicit interaction/approval that names a responder, or choose a disposition, retry, or reassignment.";
