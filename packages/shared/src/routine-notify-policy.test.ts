import { describe, expect, it } from "vitest";
import {
  CORRECTIVE_SILENT_NOTIFY_OVERRIDE,
  SILENT_NOTIFY_DISPOSITION_OVERRIDE,
  buildRoutineRunBrief,
  deriveNotifyPolicyFromDescription,
  resolveRoutineNotifyPolicy,
} from "./routine-notify-policy.js";
import { createRoutineSchema, updateRoutineSchema } from "./validators/routine.js";

describe("routine notifyPolicy", () => {
  it("accepts typed notifyPolicy on create and rejects invalid values", () => {
    expect(createRoutineSchema.parse({
      title: "Argus Hostman Ingest",
      notifyPolicy: "silent",
    }).notifyPolicy).toBe("silent");

    expect(createRoutineSchema.parse({
      title: "Jarvis Standup",
    }).notifyPolicy).toBe("alert");

    expect(() => createRoutineSchema.parse({
      title: "Bad",
      notifyPolicy: "quiet",
    })).toThrow();
  });

  it("accepts notifyPolicy on update and rejects invalid values", () => {
    expect(updateRoutineSchema.parse({ notifyPolicy: "always" }).notifyPolicy).toBe("always");
    expect(() => updateRoutineSchema.parse({ notifyPolicy: "mute" })).toThrow();
  });

  it("derives silent from legacy prose and defaults to alert", () => {
    expect(deriveNotifyPolicyFromDescription(
      "Rotina migrada. Notify policy: silent. Tipo: script.",
    )).toBe("silent");
    expect(deriveNotifyPolicyFromDescription("No policy line")).toBe("alert");
    expect(deriveNotifyPolicyFromDescription(null)).toBe("alert");
  });

  it("silent brief contains disposition override; alert preserves base only", () => {
    const base = "Se OK: responder exactamente [SILENT]. Só reportar falha.";
    const silentBrief = buildRoutineRunBrief(base, "silent");
    expect(silentBrief).toContain(base);
    expect(silentBrief).toContain(SILENT_NOTIFY_DISPOSITION_OVERRIDE);

    const alertBrief = buildRoutineRunBrief(base, "alert");
    expect(alertBrief).toBe(base);
    expect(alertBrief).not.toContain(SILENT_NOTIFY_DISPOSITION_OVERRIDE);
  });

  it("resolve prefers explicit notifyPolicy over prose", () => {
    expect(resolveRoutineNotifyPolicy({
      notifyPolicy: "always",
      description: "Notify policy: silent",
    })).toBe("always");
    expect(resolveRoutineNotifyPolicy({
      notifyPolicy: "alert",
      description: "Notify policy: silent",
    })).toBe("alert");
    expect(resolveRoutineNotifyPolicy({
      description: "Notify policy: silent",
    })).toBe("silent");
  });

  it("exports R2 corrective override distinct from the brief override", () => {
    expect(CORRECTIVE_SILENT_NOTIFY_OVERRIDE).toContain("disposição");
    expect(CORRECTIVE_SILENT_NOTIFY_OVERRIDE).toContain("silent");
    expect(CORRECTIVE_SILENT_NOTIFY_OVERRIDE).not.toBe(SILENT_NOTIFY_DISPOSITION_OVERRIDE);
  });
});
