import type { RoutineNotifyPolicy } from "./constants.js";
import { ROUTINE_NOTIFY_POLICIES } from "./constants.js";

/** Brief override when notifyPolicy is silent — notification only; disposition is mandatory. */
export const SILENT_NOTIFY_DISPOSITION_OVERRIDE =
  "notify policy silent afeta apenas a notificação humana; registre sempre a disposição.";

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
