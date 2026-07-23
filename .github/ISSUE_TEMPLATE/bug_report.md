---
name: Bug Report
about: Report a bug in @fastpix/supabase
title: "[BUG] "
labels: bug
assignees: ""
---

# Bug Report

Thank you for reporting a bug in `@fastpix/supabase`.

Complete the sections below to help us reproduce and investigate the issue.

> **Important**
>
> Never include secrets. Redact connection strings, API tokens, webhook signing secrets, service-role keys, and stream keys.

## Description

A clear and concise description of the bug.

<!-- Example: `init` didn't patch config.toml, the webhook returns 401, the queue fills but never
     drains, or a stored column has the wrong value -->

## Severity

How severely does this issue affect your application?

- [ ] Blocks production
- [ ] High
- [ ] Medium
- [ ] Low

## Setup

Describe how you installed and initialized the integration.

```bash
npx supabase init
npx supabase start
npx @fastpix/supabase init
```

<!-- If you edited a generated function or its deno.json pin, paste the relevant part here. -->

```ts
// supabase/functions/fastpix-webhook/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { webhook } from "@fastpix/supabase/deno";

Deno.serve(webhook);
```

## Which part is affected?

- [ ] `init` — copying migrations / generating edge functions
- [ ] `init` — `config.toml` patching (`verify_jwt`)
- [ ] `init` / `migrate` — creating the `fastpix` schema and tables
- [ ] pgmq queue or Supabase Cron setup (the SQL migrations)
- [ ] `fastpix-webhook` — ingest, signature verification, enqueue
- [ ] `fastpix-worker` — queue drain, processing, retry / archive
- [ ] Workflow dispatch (`FASTPIX_WORKFLOWS`)
- [ ] `fastpix-backfill` — one-off import
- [ ] `fastpix-reconcile` — nightly heal
- [ ] Data mapping / stored column values
- [ ] Packaging (`dist/`, `exports`, the `@fastpix/supabase/deno` import)
- [ ] Other (describe):

## Steps to Reproduce

1. …
2. …
3. …

## Minimal Reproduction (Optional)

If possible, provide a link to a minimal repository or attach a small project that reproduces the issue.

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened.

## Webhook event / payload (if relevant)

<!-- Paste the event `type` and a REDACTED payload. Remove stream_key / srt_secret / tokens. -->

```json

```

## Logs or error messages

<!-- CLI output, `supabase functions serve` logs, or the Edge Function logs from the dashboard.
     Do NOT include the connection string, the service-role key, or any secret. -->

```

```

## Queue / event state (if relevant)

<!-- Helpful when events are stored but never projected. Redact nothing here — these are ids only. -->

```sql
select "id", "type", "processStatus", "lastError" from fastpix.webhook_events order by "id" desc limit 10;
select count(*) from pgmq.q_fastpix_jobs;
select count(*) from pgmq.a_fastpix_jobs;
```

## Environment

- `@fastpix/supabase` version:
- `@fastpix/fp-sync-engine` version (the pin in your function's `deno.json`):
- Supabase: [ ] local (`supabase start`) [ ] hosted project [ ] both
- Supabase CLI version (`npx supabase --version`):
- Node.js version (`node -v`):
- Package manager: [ ] npm [ ] yarn [ ] pnpm [ ] bun
- Postgres version:
- OS:
- Edge functions deployed with: [ ] `supabase functions serve` [ ] `supabase functions deploy`

## Additional Context

Anything else that helps (screenshots of the DB rows, cron job status, timing, related events).

## Checklist

- [ ] Redacted all secrets and connection strings
- [ ] Included the `@fastpix/supabase` version + whether it's local or hosted
- [ ] Provided steps to reproduce
- [ ] Confirmed the two cron jobs exist and the Vault secrets are set (see the README)
- [ ] Checked this isn't already reported
