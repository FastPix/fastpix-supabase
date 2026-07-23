-- 0001_fastpix_enable_pgmq.sql — enable the queue extension and create the job queue.
--
-- NOTE: the `fastpix` schema and its tables are NOT created by any migration in this package.
-- The sync engine creates them at runtime (runMigrations()), identically on Supabase or on plain
-- Postgres. These three migrations cover only the Supabase-specific wiring the portable engine
-- cannot know about: the queue, its RPC surface, and the cron schedules.

-- Enable the pgmq extension for message queues
CREATE EXTENSION IF NOT EXISTS pgmq;

SELECT pgmq.create('fastpix_jobs');

ALTER TABLE pgmq.q_fastpix_jobs ENABLE ROW LEVEL SECURITY;

CREATE SCHEMA IF NOT EXISTS pgmq_public;

-- Grants for API roles.
--
-- DELIBERATE CHOICE: do NOT grant usage + execute here to
-- `anon, authenticated, service_role`. The anon key ships in browsers, and these wrappers are
-- SECURITY DEFINER (so they bypass the RLS enabled above). Granting anon would let any holder of
-- the public key call pgmq_public.delete() and silently drop queued sync jobs, or read()/pop()
-- them out from under the worker. Nothing in this package needs client-side queue access — the
-- Edge Functions hold a direct Postgres connection (SUPABASE_DB_URL) — so only service_role is
-- granted. Add anon/authenticated ONLY if you build a client that must enqueue, and add a policy
-- to match.
GRANT USAGE ON SCHEMA pgmq_public TO service_role;
