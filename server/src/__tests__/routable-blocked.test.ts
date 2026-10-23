import { describe, expect, it, vi } from "vitest";
import { createIssueThreadInteractionSchema } from "@paperclipai/shared";
import {
  buildUnblockDescriptorConfirmation,
  deliverAgentUnblockNotification,
  ROUTABLE_BLOCKED_ROLLOUT_AT,
  unblockNotificationIdempotencyKey,
} from "../services/routable-blocked.js";

const agentId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000099";

function blockedIssue(
  input: {
    transitionAt?: Date | null;
    notifiedAt?: Date | null;
    owner?:
      | { agentId: string }
      | { userId: string }
      | "board";
    action?: string;
  } = {},
) {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    companyId: "00000000-0000-4000-8000-000000000003",
    status: "blocked",
    unblockDescriptor: {
      owner: input.owner ?? { agentId },
      action: input.action ?? "Review the finding",
    } as const,
    blockedTransitionAt:
      input.transitionAt === undefined
        ? new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() + 1)
        : input.transitionAt,
    blockedOwnerNotifiedAt: input.notifiedAt ?? null,
  };
}

describe("routable blocked notifications", () => {
  it("builds a board request_confirmation payload that parses (R6)", () => {
    const confirmation = buildUnblockDescriptorConfirmation({
      action: "Approve the exception",
      idempotencyKey: "issue-unblock:test",
    });
    const parsed = createIssueThreadInteractionSchema.parse(confirmation);
    expect(parsed).toMatchObject({
      kind: "request_confirmation",
      resolverPolicy: "human_only",
      continuationPolicy: "wake_assignee",
      payload: { version: 1, prompt: "Approve the exception", allowDeclineReason: true },
    });
  });

  it("wakes the named agent and records delivery on a prospective transition", async () => {
    const wakeup = vi.fn(async () => undefined);
    const markNotified = vi.fn(async () => undefined);
    const now = new Date("2026-07-23T18:30:00.000Z");
    const issue = blockedIssue();

    await expect(
      deliverAgentUnblockNotification({ issue, wakeup, markNotified, now: () => now }),
    ).resolves.toBe(true);
    expect(wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        reason: "issue_unblock_requested",
        idempotencyKey: `issue-unblock:${issue.id}:${issue.blockedTransitionAt!.toISOString()}`,
        payload: { issueId: issue.id, action: "Review the finding" },
      }),
    );
    expect(markNotified).toHaveBeenCalledWith(now);
  });

  it("creates a human owner path for board-owned unblockDescriptor (R6)", async () => {
    const wakeup = vi.fn(async () => undefined);
    const createHumanOwnerPath = vi.fn(async () => undefined);
    const markNotified = vi.fn(async () => undefined);
    const now = new Date("2026-07-23T18:30:00.000Z");
    const issue = blockedIssue({ owner: "board", action: "Approve the exception" });

    await expect(
      deliverAgentUnblockNotification({
        issue,
        wakeup,
        createHumanOwnerPath,
        markNotified,
        now: () => now,
      }),
    ).resolves.toBe(true);

    expect(wakeup).not.toHaveBeenCalled();
    expect(createHumanOwnerPath).toHaveBeenCalledWith({
      issueId: issue.id,
      companyId: issue.companyId,
      action: "Approve the exception",
      idempotencyKey: unblockNotificationIdempotencyKey(
        issue as Parameters<typeof unblockNotificationIdempotencyKey>[0],
      ),
      owner: "board",
    });
    expect(markNotified).toHaveBeenCalledWith(now);
  });

  it("creates a human owner path for user-owned unblockDescriptor", async () => {
    const wakeup = vi.fn(async () => undefined);
    const createHumanOwnerPath = vi.fn(async () => undefined);
    const markNotified = vi.fn(async () => undefined);
    const issue = blockedIssue({ owner: { userId }, action: "Review access" });

    await expect(
      deliverAgentUnblockNotification({
        issue,
        wakeup,
        createHumanOwnerPath,
        markNotified,
      }),
    ).resolves.toBe(true);

    expect(wakeup).not.toHaveBeenCalled();
    expect(createHumanOwnerPath).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { userId },
        action: "Review access",
      }),
    );
    expect(markNotified).toHaveBeenCalled();
  });

  it("skips board notification when createHumanOwnerPath is not wired", async () => {
    const wakeup = vi.fn(async () => undefined);
    const markNotified = vi.fn(async () => undefined);

    await expect(
      deliverAgentUnblockNotification({
        issue: blockedIssue({ owner: "board" }),
        wakeup,
        markNotified,
      }),
    ).resolves.toBe(false);
    expect(wakeup).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
  });

  it("leaves pre-existing blocked issues untouched", async () => {
    const wakeup = vi.fn(async () => undefined);
    const markNotified = vi.fn(async () => undefined);

    await expect(
      deliverAgentUnblockNotification({
        issue: blockedIssue({
          transitionAt: new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() - 1),
        }),
        wakeup,
        markNotified,
      }),
    ).resolves.toBe(false);
    expect(wakeup).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
  });

  it("deduplicates one transition and notifies again after a blocked flap", async () => {
    const wakeup = vi.fn(async () => undefined);
    const markNotified = vi.fn(async () => undefined);
    const firstTransition = new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() + 1);
    const secondTransition = new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() + 2);

    await deliverAgentUnblockNotification({
      issue: blockedIssue({ transitionAt: firstTransition, notifiedAt: new Date() }),
      wakeup,
      markNotified,
    });
    await deliverAgentUnblockNotification({
      issue: blockedIssue({ transitionAt: secondTransition }),
      wakeup,
      markNotified,
    });

    expect(wakeup).toHaveBeenCalledTimes(1);
    expect(wakeup.mock.calls[0]?.[1]).toMatchObject({
      idempotencyKey: expect.stringContaining(secondTransition.toISOString()),
    });
  });
});
