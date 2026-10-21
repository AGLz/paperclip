ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "notify_policy" text DEFAULT 'alert' NOT NULL;
