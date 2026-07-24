-- 0003_fastpix_setup_cron_job.sql — the schedules that drive the async topology.
--
-- Without these the queue fills but nothing consumes it: Deno.serve only runs on an HTTP request,
-- so something has to poke the functions. Secrets come from the Vault (created out of band — see
-- the README) and are NEVER inlined here.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drain the queue. '10 seconds' is pg_cron sub-minute interval syntax (needs pg_cron >= 1.5;
-- Supabase ships 1.6.x). Worst-case webhook->database
-- latency ~10s instead of ~60s; throughput ceiling ~3,600 events/hour at batch size 10.
--
-- Cost: invokes the worker 8,640x/day rather than 1,440x/day. Inside Supabase's free 500k monthly
-- invocations, but it becomes the dominant consumer — use '* * * * *' if that matters more.
--
-- Concurrency is safe: net.http_post is fire-and-forget so cron never blocks, and pgmq's 30s
-- visibility timeout (set in fastpix-worker) exceeds this 10s tick, so overlapping runs cannot
-- claim the same message.
SELECT cron.schedule(
  'fastpix-drain-worker',
  '10 seconds',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fastpix_functions_url') || '/fastpix-worker',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fastpix_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Nightly reconcile: re-fetch resources active in the last 24h and upsert current API state,
-- healing webhooks that never arrived at all. The drain loop only ever sees events that DID
-- arrive, so without this a missed webhook stays missed. The command is stored as text and only
-- runs at 03:00, so missing Vault secrets don't break `supabase db reset`.
SELECT cron.schedule(
  'fastpix-nightly-reconcile',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fastpix_functions_url') || '/fastpix-reconcile',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fastpix_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
