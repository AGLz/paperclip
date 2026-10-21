import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";
import type { IssueUnblockDescriptor } from "@paperclipai/shared";
import { issueThreadInteractionService } from "./issue-thread-interactions.js";
import {
  buildUnblockDescriptorConfirmation,
  deliverAgentUnblockNotification,
  type UnblockOwnerWakeup,
} from "./routable-blocked.js";

type UnblockNotifyIssue = {
  id: string;
  companyId: string;
  status: string;
  unblockDescriptor?: IssueUnblockDescriptor | null;
  blockedTransitionAt?: Date | null;
  blockedOwnerNotifiedAt?: Date | null;
};

/**
 * R6 delivery for a blocked issue that already has unblockDescriptor set.
 * Agent owners get a wake; board/user owners get a request_confirmation card.
 */
export async function notifyUnblockDescriptorOwner(input: {
  db: Db;
  issue: UnblockNotifyIssue;
  wakeup: UnblockOwnerWakeup;
  now?: () => Date;
}): Promise<{ delivered: boolean; blockedOwnerNotifiedAt: Date | null }> {
  const { db, issue } = input;
  if (
    issue.status !== "blocked" ||
    !issue.unblockDescriptor ||
    issue.blockedOwnerNotifiedAt
  ) {
    return { delivered: false, blockedOwnerNotifiedAt: null };
  }

  let ownerNotifiedAt: Date | null = null;
  const delivered = await deliverAgentUnblockNotification({
    issue,
    wakeup: input.wakeup,
    createHumanOwnerPath: async ({
      issueId,
      action,
      idempotencyKey,
      owner,
    }) => {
      await issueThreadInteractionService(db).create(
        { id: issueId, companyId: issue.companyId },
        buildUnblockDescriptorConfirmation({
          action,
          idempotencyKey,
          addresseeUserId:
            owner !== "board" && "userId" in owner ? owner.userId : null,
        }),
        { systemId: "routable-blocked" },
      );
    },
    markNotified: async (blockedOwnerNotifiedAt) => {
      ownerNotifiedAt = blockedOwnerNotifiedAt;
    },
    now: input.now,
  });

  if (!ownerNotifiedAt) {
    return { delivered: false, blockedOwnerNotifiedAt: null };
  }

  await db
    .update(issues)
    .set({ blockedOwnerNotifiedAt: ownerNotifiedAt })
    .where(and(eq(issues.id, issue.id), eq(issues.companyId, issue.companyId)));

  return { delivered, blockedOwnerNotifiedAt: ownerNotifiedAt };
}
