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
  [PR #16433](https://github.com/paperclipai/paperclip/pull/16433). User approved
  building on that PR. Added safety commits to its existing branch, preserving
  Devin’s original commit; current published revision is `5eb505ff5d1b3aabf94e06ece51873ad09d3f696`.
- Earlier proof/implementation preserved at `da754ff744` on
  `codex/recoverable-skill-cache`; do not ship its competing worker.
- Staging: `paperclip.staging.paperclip.app`, stack `stack-pool-50531a9d17dd`.
- Diagnosis complete; staging unchanged; temporary SSH key revoked and removed.
- Integrated one worker, cross-process preparation/pin locks, separate last-use
  metadata, legacy observation grace, unresolved-recovery protection, dry run,
  bounded scans/continuations, and deletion outside the preparation lock.
- First integrated run: 22 focused tests passed; broader controls passed 100/101.
  Removed an unnecessary explicit-deletion lock exposed by the rollback fixture;
  that control passed on rerun (12.21s). The original failure remains in
  `/tmp/paperclip-skill-integration-controls.log`.
- Full typecheck initially found a plugin dependency API mismatch from the
  unlocked bootstrap install. Current master supplied the refreshed lockfile;
  frozen install completed in 18.7s and full typecheck passed in 59.82s.
- Review at `5eb505ff5d` was 3/5: unsafe skill roots blocked the company sweep,
  and recursive byte counts held the preparation lock. Both fixed locally;
  18 affected tests passed in 24.94s, including preparation during a paused file
  walk and fresh pin revalidation. Server typecheck passed after those fixes.
- Full tests were stopped after approximately four minutes to address review
  findings before final qualification; no full-suite pass claimed. Required
  tests/build and final review remain. Git source unchanged.
- First Git baseline used a real bare remote, runtime workspace creation, a
  database row, and ordinary reopening: missing worktree restores A while its
  branch exists; missing branch restores upstream B; missing base fails. Fixture
  script `/tmp/paperclip-git-recovery-baseline.mts`, inspected output
  `/tmp/paperclip-git-recovery-baseline.json`, retained Git fixture
  `/tmp/paperclip-git-baseline-sbJWbo`. The test DB was cleaned up.
- No deployed artifact or staging acceptance yet. Next: publish review fixes,
  qualify final skill SHA, then perform dry-run rollout and measured restoration.

## Feedback-loop evidence

| Question | Environment / loop | Elapsed / main wait | Result / next decision |
| --- | --- | --- | --- |
| Can this checkout run focused tests? | Local dependency setup | 43.2s install; later one-time Runner build took several minutes | Baseline manifest/lock drift required install without changing CI-owned lockfile. Warm builds are now reusable. |
| Can an older skill restore without upstream? | Existing service with real Postgres snapshots, pre-cleanup proof at baseline `57fa6b358d` | 4.83s warm test attempt; setup excluded as one-time above | Normal runtime path restored saved binary/script bytes and executable bits with fetch unavailable; proceed with cleanup. |
| Do the integrated safety cases hold? | Devin's `0f3adda980` plus local follow-up; real Postgres and filesystem | 49s from launch through inspected result, 47.23s runner (62% tests, 21% import) | 22 tests passed, server typecheck passed. Added deleted-skill and failure-budget review cases plus heartbeat controls. No cloud proof claimed. |

| Does Git reopening preserve A after upstream moves? | `5eb505ff5d`, local bare remote plus real runtime/service/database path | 6.398s setup/run/inspection script, about 9s launch through result review | Missing branch returned B; missing base failed. Preserve fixture for exact-commit restoration tests. |
| Does cleanup block preparation during a slow file walk? | Same checkout plus review fixes, two DB clients and a deliberately paused filesystem read | 24.94s affected suite, about 28s through inspected result | 18 tests pass; preparation completes while scan is paused and its new pin prevents eviction. |

## Deferred

Skill-version creation/deduplication, recovery retention, non-Git workspace expiry,
shared/operator checkout expiry, and moving storage off the webserver.
