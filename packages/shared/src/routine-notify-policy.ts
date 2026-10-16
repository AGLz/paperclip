import type { RoutineNotifyPolicy } from "./constants.js";
import { ROUTINE_NOTIFY_POLICIES } from "./constants.js";

/** Brief override when notifyPolicy is silent — notification only; disposition is mandatory. */
export const SILENT_NOTIFY_DISPOSITION_OVERRIDE =
  "notify policy silent afeta apenas a notificação humana; registre sempre a disposição.";

/**
 * Corrective handoff override (R2 / AGL-239). Placed at the top of the
 * `successful_run_missing_state` prompt so it wins over a silent routine brief
 * that would otherwise make the agent answer `[SILENT]` again without a disposition.
 * Does not edit the stored routine brief — only the corrective wake instruction.
 */
export const CORRECTIVE_SILENT_NOTIFY_OVERRIDE =
  "Você deve registrar uma disposição mesmo quando a política de notificação da rotina é silent.";

const PROSE_SILENT_RE = /notify\s*policy\s*:\s*silent/i;

export function isRoutineNotifyPolicy(value: unknown): value is RoutineNotifyPolicy {
  return typeof value === "string" && (ROUTINE_NOTIFY_POLICIES as readonly string[]).includes(value);
}

/**
 * Derive notifyPolicy from legacy prose in routine.description.
 * Default is `alert` (human-visible, current behavior) when prose is absent.
 */
export function deriveNotifyPolicyFromDescription(description: string | null | undefined): RoutineNotifyPolicy {
  if (description && PROSE_SILENT_RE.test(description)) return "silent";
  return "alert";
}

/**
 * Build the issue description/brief for a routine run.
 * Silent policy appends the disposition override; alert/always preserve the base brief.
 */
export function buildRoutineRunBrief(
  baseDescription: string | null | undefined,
  notifyPolicy: RoutineNotifyPolicy,
  descriptionAppendix?: string | null,
): string {
  const parts: string[] = [];
  if (baseDescription && baseDescription.trim()) parts.push(baseDescription);
  if (notifyPolicy === "silent") parts.push(SILENT_NOTIFY_DISPOSITION_OVERRIDE);
  if (descriptionAppendix && descriptionAppendix.trim()) parts.push(descriptionAppendix);
  return parts.join("\n\n");
}

export function resolveRoutineNotifyPolicy(input: {
  notifyPolicy?: RoutineNotifyPolicy | null;
  description?: string | null;
}): RoutineNotifyPolicy {
  if (isRoutineNotifyPolicy(input.notifyPolicy)) return input.notifyPolicy;
  return deriveNotifyPolicyFromDescription(input.description);
}
