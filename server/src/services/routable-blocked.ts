import type {
  CreateIssueThreadInteraction,
  IssueUnblockDescriptor,
} from "@paperclipai/shared";

export const ROUTABLE_BLOCKED_ROLLOUT_AT = new Date("2026-07-23T18:13:03.000Z");

type RoutableBlockedIssue = {
  id: string;
  companyId?: string;
  status: string;
  unblockDescriptor?: IssueUnblockDescriptor | null;
  blockedTransitionAt?: Date | null;
  blockedOwnerNotifiedAt?: Date | null;
};

type ProspectiveBlockedIssue = RoutableBlockedIssue & {
  status: "blocked";
  blockedTransitionAt: Date;
};

export type UnblockOwnerWakeup = (
  agentId: string,
  options: {
    source: "automation";
    triggerDetail: "system";
    reason: "issue_unblock_requested";
    idempotencyKey: string;
    payload: { issueId: string; action: string };
    contextSnapshot: {
      wakeReason: "issue_unblock_requested";
      issueId: string;
      taskId: string;
    };
  },
) => Promise<unknown>;

export type UnblockHumanOwnerPath = (input: {
  issueId: string;
  companyId?: string;
  action: string;
  idempotencyKey: string;
  owner: "board" | { userId: string };
}) => Promise<unknown>;

export function isProspectiveBlockedTransition(
  issue: RoutableBlockedIssue,
): issue is ProspectiveBlockedIssue {
  return (
    issue.status === "blocked" &&
    Boolean(
      issue.blockedTransitionAt &&
        issue.blockedTransitionAt >= ROUTABLE_BLOCKED_ROLLOUT_AT,
    )
  );
}

export function unblockNotificationIdempotencyKey(
  issue: ProspectiveBlockedIssue,
): string {
  return `issue-unblock:${issue.id}:${issue.blockedTransitionAt.toISOString()}`;
}

/** Payload for the board/user confirmation that owns an unblockDescriptor action (R6). */
export function buildUnblockDescriptorConfirmation(input: {
  action: string;
  idempotencyKey: string;
  addresseeUserId?: string | null;
}): CreateIssueThreadInteraction {
  const action = input.action.trim().slice(0, 1000) || "Complete the named unblock action";
  return {
    kind: "request_confirmation",
    idempotencyKey: input.idempotencyKey,
    continuationPolicy: "wake_assignee",
    resolverPolicy: "human_only",
    title: "Unblock required",
    summary: action.slice(0, 1000),
    addresseeUserId: input.addresseeUserId ?? null,
    payload: {
      version: 1,
      prompt: action,
      acceptLabel: "Unblocked",
      rejectLabel: "Still blocked",
      detailsMarkdown: `Named unblock action:\n\n${action}`,
    },
  };
}

/**
 * R6: a named unblockDescriptor owner must receive a first wake/path.
 * Agent owners get a wake; board/user owners get an explicit interaction path.
 */
export async function deliverAgentUnblockNotification(input: {
  issue: RoutableBlockedIssue;
  wakeup: UnblockOwnerWakeup;
  /** Board/user owners — create request_confirmation (or equivalent approval). */
  createHumanOwnerPath?: UnblockHumanOwnerPath;
  markNotified: (notifiedAt: Date) => Promise<unknown>;
  now?: () => Date;
}) {
  const { issue } = input;
  if (
    !isProspectiveBlockedTransition(issue) ||
    !issue.unblockDescriptor ||
    issue.blockedOwnerNotifiedAt
  ) {
    return false;
  }

  const owner = issue.unblockDescriptor.owner;
  const action = issue.unblockDescriptor.action;
  const idempotencyKey = unblockNotificationIdempotencyKey(issue);

  if (owner === "board" || ("userId" in owner && !("agentId" in owner))) {
    if (!input.createHumanOwnerPath) return false;
    await input.createHumanOwnerPath({
      issueId: issue.id,
      companyId: issue.companyId,
      action,
      idempotencyKey,
      owner: owner === "board" ? "board" : { userId: owner.userId },
    });
    await input.markNotified((input.now ?? (() => new Date()))());
    return true;
  }

  if (!("agentId" in owner)) return false;

  await input.wakeup(owner.agentId, {
    source: "automation",
    triggerDetail: "system",
    reason: "issue_unblock_requested",
    idempotencyKey,
    payload: { issueId: issue.id, action },
    contextSnapshot: {
      wakeReason: "issue_unblock_requested",
      issueId: issue.id,
      taskId: issue.id,
    },
  });
  await input.markNotified((input.now ?? (() => new Date()))());
  return true;
}
