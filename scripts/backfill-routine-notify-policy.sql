-- AGL-236 backfill: derive routines.notify_policy from legacy prose in description.
-- Default column value is 'alert'. Flip to 'silent' when description contains
-- "Notify policy: silent" (case-insensitive).
--
-- Safe to re-run. Does not rewrite description prose (Fase 3 owns brief override text).
--
-- Apply after migration 0347_routine_notify_policy:
--   psql "$DATABASE_URL" -f scripts/backfill-routine-notify-policy.sql

BEGIN;

UPDATE routines
SET notify_policy = 'silent',
    updated_at = NOW()
WHERE notify_policy IS DISTINCT FROM 'silent'
  AND description ~* 'notify[[:space:]]*policy[[:space:]]*:[[:space:]]*silent';

-- Optional audit:
-- SELECT id, title, notify_policy,
--        (description ~* 'notify[[:space:]]*policy[[:space:]]*:[[:space:]]*silent') AS prose_silent
-- FROM routines
-- ORDER BY updated_at DESC;

COMMIT;
