# Recoverable disk cleanup — delivery state

## Outcome and boundaries

Automatically expire reproducible skill caches and finished isolated Git workspaces,
then restore them through normal use. Deliver two reviewed slices and verify actual
reclamation plus restoration on `paperclip.staging.paperclip.app`. Keep the current
storage architecture, unique work, and recovery data. Git restoration may depend
on upstream availability; skill restoration must use saved database bytes alone.

Apply dotta-kickoff, goal-poteto-style-definition, shorten-feedback-loop,
paperclip-feature-to-production, and test-it-for-real. Retain one deployment owner.

## Acceptance matrix

| Case | Required outcome |
| --- | --- |
| Old skill version, upstream unavailable | Identical restored bytes and executable modes |
| Current/active/unsettled skill version | Preserved through concurrent preparation and cleanup |
| Finished Git workspace/base, upstream advanced | Reopen at recorded commit and perform subsequent work |
| Unique files, live consumers, pending recovery | Skip cleanup |
| Restart/concurrent reopen/interrupted deletion | Recover safely and preserve lifecycle fencing |
| Upstream failure/cross-company access | Explicit failure or skip; no fallback or access widening |

## Delivery slices

1. Skill `__versions__` cache: one-hour inactivity, current/in-use protection,
   persistent access records, cross-process exclusion, hourly batches of 50.
2. Owned isolated Git workspace/base caches: 24-hour terminal-tree cooldown,
   verified exact-commit recipe before deletion, safe on-demand restoration.

Each slice gets focused tests, required repository checks, review, single-workspace
deployment at an exact SHA, dry-run inspection, measured reclamation, and ordinary
product acceptance. Rollback disables deletion and retains restoration support.

## Current state

- Checkout: `/Users/dotta/.codex/worktrees/2da2/paperclip`
- Branch: `codex/skill-cache-retention-safety`, based on Devin Foley's
  [PR #16433](https://github.com/paperclipai/paperclip/pull/16433), head
  `0f3adda9806803d40e8eec874cd48cfcfc5ce467`. User approved building on that PR.
- Earlier proof/implementation preserved at `da754ff744` on
  `codex/recoverable-skill-cache`; do not ship its competing worker.
- Staging: `paperclip.staging.paperclip.app`, stack `stack-pool-50531a9d17dd`.
- Diagnosis complete; staging unchanged; temporary SSH key revoked and removed.
- Integrated one worker, cross-process preparation/pin locks, separate last-use
  metadata, legacy observation grace, unresolved-recovery protection, dry run,
  bounded scans/continuations, and deletion outside the preparation lock.
- First integrated run: 22 focused tests passed; server typecheck passed. Added
  review follow-ups for deleted-but-running skills and bounded failed attempts;
  broader skill/heartbeat controls in progress. Full checks/review remain.
- No new PR, deployed artifact, or staging acceptance result yet. Git slice not
  implemented. Next: finish controls, full checks, reviewed first-slice handoff.

## Feedback-loop evidence

| Question | Environment / loop | Elapsed / main wait | Result / next decision |
| --- | --- | --- | --- |
| Can this checkout run focused tests? | Local dependency setup | 43.2s install; later one-time Runner build took several minutes | Baseline manifest/lock drift required install without changing CI-owned lockfile. Warm builds are now reusable. |
| Can an older skill restore without upstream? | Existing service with real Postgres snapshots, pre-cleanup proof at baseline `57fa6b358d` | 4.83s warm test attempt; setup excluded as one-time above | Normal runtime path restored saved binary/script bytes and executable bits with fetch unavailable; proceed with cleanup. |
| Do the integrated safety cases hold? | Devin's `0f3adda980` plus local follow-up; real Postgres and filesystem | 49s from launch through inspected result, 47.23s runner (62% tests, 21% import) | 22 tests passed, server typecheck passed. Added deleted-skill and failure-budget review cases plus heartbeat controls. No cloud proof claimed. |

## Deferred

Skill-version creation/deduplication, recovery retention, non-Git workspace expiry,
shared/operator checkout expiry, and moving storage off the webserver.
