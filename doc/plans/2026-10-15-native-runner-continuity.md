# Native runner continuity through controller and process loss

## Goal and delivery boundary

Ship a verified fix to the selected staging instance and recover the two reported
tasks from their retained work. Normal follow-up messages, server restarts, and
recoverable runner loss must not strand a task behind
`native_continuation_requires_reconciliation` or
`runner_state_identity_mismatch: prior_owner_terminal_state_indeterminate`.
Removing an error label, clearing a hold without evidence, or blindly starting
another provider does not meet this goal.

The user authorized implementation, review, merge, staging deployment, and task
recovery. The supported release covers the affected native Codex and native
OpenCode remote execution paths, plus shared lifecycle regression controls.
It preserves existing company, ownership, Stop, pause, approval, budget, and
workspace boundaries. Genuine conflicting ownership or an unresolved external
effect must remain safe and actionable. This is not a promise that infrastructure
can never fail; it is a checkable promise that the specified failures do not lose
work or require users to diagnose runner internals.

## Acceptance matrix

| Journey or fault | Required result | Evidence |
| --- | --- | --- |
| Completed turn followed immediately by another user message | Next turn starts once with the saved history, workspace, and message | Real assembled-service regression and staging journey |
| Controller restart while a session is idle, including immediately after completion | Durable evidence suffices to resume or safely replace the runner; no process-local ownership dependency strands the task | Hard and graceful restart fault tests |
| Restart during startup or an active turn | Adopt the exact live execution or fence it before one bounded successor; preserve accepted results and pending messages | Real process/transport boundary fault tests |
| Remote process exits or identity cannot initially be read | Distinguish a transient probe failure, a dead execution, and a conflicting owner; reconcile automatically when evidence permits | Linux remote-process tests and persisted recovery timeline |
| Crash during checkpoint, recovery, or workspace copy-back | Resume the persistence obligation without replaying completed provider work; retain the sole recoverable source until saved | Restart/concurrency regression with independently checked file contents |
| Existing saved or quarantined state from the affected release | Recover eligible old state without requiring a newly created task or discarding its history | Compatibility fixture and recovery of both reported tasks |
| Duplicate recovery workers, lost acknowledgements, and newer user messages | At most one successor and one delivery of each message; no replay of a completed external action | Durable ledger and side-effect counter assertions |
| Wrong company/session, a genuinely live competing owner, Stop/pause, revoked access, or unknown external effect | No unsafe adoption, signalling, destruction, or speculative action replay; concrete remaining blocker | Negative controls |
| Deployment | Running staging application and any changed runner artifact match the tested revisions; both tasks have useful results or their genuine task-level disposition | Live revision, run, file, and task inspection |

Use the existing recovery budgets (three provider attempts including the original,
30-second failure retry interval) and control-transition contract (60-second
deadline, 15-second reconciliation, resolution or explicit blocker within 90 seconds
with healthy dependencies). Provider work duration is not bounded by this timer.
Restarts must not reset budgets. Any necessary departure requires explicit evidence
and an updated contract, not a silent relaxation of acceptance.

## Investigation and implementation slices

1. Establish both baseline failure paths from persisted evidence. The remote
   identity failure still needs its exact failing operation established; do not
   infer process death from the generic error alone.
2. Close the completed-turn ownership/checkpoint gap in its existing lifecycle
   owner, including compatibility with retained old state. Test prevention and
   recovery, not only an isolated predicate.
3. Close the demonstrated remote recovery gap using existing fencing, finalization,
   workspace retention, and continuation services. Keep diagnostics precise enough
   to distinguish probe unavailability from conflicting identity.
4. Qualify the changed boundary locally first, then on a representative remote
   Linux target and staging. Prepare reviewable changes and required repository
   checks; deploy the verified revision and recover the original tasks.

The first discriminating experiment is a completed native remote turn whose
controller is lost before a follow-up. Recreate the old persisted state through
the real lifecycle, then attempt the follow-up with an empty process-local owner
map. Preserve real persistence, transport, and process boundaries where mocks
would hide the failure. Existing recovery E2E and native restart suites are the
starting harnesses; past passing evidence does not qualify this change.

## Current state

- Branch: `codex/native-runner-recovery`, based on `afe5b3418d`.
- Canonical workspace: this branch's isolated checkout.
- Existing local Codex quiescent-state recovery deliberately excludes remote
  targets. Remote prior-run validation currently requires a verified suspended
  state or the exact in-memory warm owner.
- Implemented remote turn suspension before completion and bounded retries for
  unavailable remote identity probes. The new suspension wiring test failed
  before the change and passes after it. Four transient timeout/transport cases
  also failed before the change. The expanded recovery group passes 35 checks,
  including saved-state read retries, deadline and signalling controls, and
  wrong-owner/replaced-sandbox rejection.
- The real Rust runner/local WebSocket/PostgreSQL active-run restart test passes.
  The assembled Linux container/TLS/PostgreSQL save-and-resume test also passes:
  first turn suspended and backed up, zero idle owners at restart sweep, second
  turn resumes the same history, one thread creation and two turn starts. It uses
  the current runner source and a deterministic fake Codex provider, not Daytona
  or a live model. Initial fixture failures (database bindings, TLS/port setup,
  and missing lease/coordinator records) were repaired before this result.
- Full workspace typecheck and build passed before the rebase. The first complete
  test run was interrupted to incorporate two newly merged ownership fixes;
  validation is restarting on the combined candidate. Review, staging
  qualification, old-state recovery, and live task recovery remain outstanding.
- The base includes #16432 (idle expiry serialized with admission) and #16441
  (exact warm-owner run identity independent of configuration changes). These
  fix live-controller handoffs. Remote suspension remains necessary for the
  selected release because a lost controller has no in-memory owner. Each
  remote follow-up starts a provider process with saved conversation history;
  this costs startup latency and does not preserve same-process warm reuse.
- The GLM run recorded a hard restart and `reattach_remote_runner`, followed by
  a generic identity-unavailable error. Its inspector does not retain the failed
  probe reason. This does not prove process death or a conflicting owner.
- No live task or deployment has been mutated. Next: finish checks and review,
  then qualify the release and recover the retained tasks on staging.

Deferred: unrelated skill-import setup failures, database query optimization,
general UI redesign, and broad provider qualification unrelated to the changed
shared lifecycle.
