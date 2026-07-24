# @fastpix/supabase

`@fastpix/supabase` provides a CLI that integrates your FastPix account with your Supabase project. The integration mirrors your FastPix media, live streams, and uploads into Postgres, and keeps them current from webhooks.

Setting up the integration does the following:

1. Creates a `fastpix` schema that contains the following tables:
   - `media`, for [Media](https://docs.fastpix.io)
   - `live_streams`, for [Live Streams](https://docs.fastpix.io)
   - `uploads`, for [Direct Uploads](https://docs.fastpix.io)
   - `webhook_events`, for the raw webhook event log
   - `sync_state`, for backfill and reconcile bookkeeping
2. Creates Edge Functions that receive webhooks and keep the data in the `fastpix` schema up to date.

## Table of contents

- [Before you begin](#before-you-begin)
- [Set up the integration locally](#set-up-the-integration-locally)
  - [Run init](#run-init)
  - [Create the Vault secrets](#create-the-vault-secrets)
  - [Run the webhook locally](#run-the-webhook-locally)
  - [Verify that the integration works](#verify-that-the-integration-works)
- [Understand how syncing works](#understand-how-syncing-works)
- [Backfill and reconcile data](#backfill-and-reconcile-data)
- [Trigger a function when an event syncs](#trigger-a-function-when-an-event-syncs)
- [Deploy to production](#deploy-to-production)
- [Secure the tables](#secure-the-tables)
- [Upgrade the engine](#upgrade-the-engine)
- [CLI reference](#cli-reference)
- [Environment variable reference](#environment-variable-reference)
- [Troubleshoot](#troubleshoot)

## Before you begin

Make sure you have the following:

- Node.js version 20 or later.
- Docker, which local Supabase requires.
- A Supabase project initialized in your repository. If your project doesn't contain a `supabase` directory, run `npx supabase init`. For more information, see [Supabase CLI init](https://supabase.com/docs/reference/cli/supabase-init).
- A running local Supabase instance. To start one, run `npx supabase start`.
- Your Supabase service-role key. To find it, run `npx supabase status -o env`.
- A FastPix account with an API token ID and token secret. The `init` command prompts you for both.
- Access to the FastPix dashboard, so that you can create a webhook and copy its signing secret.

## Set up the integration locally

### Run init

With your local Supabase instance running, run the `init` command and follow the prompts:

```bash
npx @fastpix/supabase init
```

The command does the following:

- Creates the `fastpix` schema and its tables.
- Creates four functions in `supabase/functions`: `fastpix-webhook`, `fastpix-worker`, `fastpix-reconcile`, and `fastpix-backfill`. These functions use the `@fastpix/fp-sync-engine` package to sync your data.
- Sets up a pgmq job queue and two Supabase Cron jobs, a queue drain and a nightly reconcile, that drive the sync.
- Prompts you to configure `FASTPIX_TOKEN_ID`, `FASTPIX_TOKEN_SECRET`, and `FASTPIX_WEBHOOK_SECRET`. The command writes these to `supabase/functions/.env`.
- Sets `verify_jwt` for each function in `config.toml`. The webhook is set to `false` because FastPix signs its requests instead of sending a Supabase JWT.

Everything `init` writes is copy-if-absent, so re-running the command is safe and never overwrites a file that you edited.

> **NOTE:** \
> If Supabase was already running when you ran `init`, restart the instance with `npx supabase stop` and `npx supabase start` so that the `config.toml` changes take effect.

### Create the Vault secrets

The two cron jobs call your Edge Functions over HTTP. They read the function URL and the service-role key from Supabase Vault, so that neither value is committed in a migration.

Until these secrets exist, the queue fills but nothing drains, and nothing reports an error.

In the SQL Editor, run the following:

```sql
select vault.create_secret('http://host.docker.internal:54321/functions/v1', 'fastpix_functions_url');
select vault.create_secret('<SERVICE_ROLE_KEY>', 'fastpix_service_role_key');
```

Locally, the URL must be reachable from inside the Postgres container, so use `host.docker.internal` rather than `localhost`. To find your service-role key, run `npx supabase status -o env`.

### Run the webhook locally

1. Serve the Edge Functions on port 54321:

   ```bash
   npx supabase functions serve
   ```

2. Expose the functions to the internet with a tunneling service such as ngrok. Your public webhook URL has a format like `https://d99d3b847eb8.ngrok-free.app/functions/v1/fastpix-webhook`.

3. In the FastPix dashboard, go to **Org Settings** > **Webhooks** > **Create new webhook** and enter that URL.

4. Copy the webhook secret from FastPix into `FASTPIX_WEBHOOK_SECRET` in `supabase/functions/.env`.

### Verify that the integration works

1. In the FastPix dashboard, confirm that you're in the correct environment, then upload a media asset.

2. In your local Supabase dashboard, open the `media` table in the `fastpix` schema. A row appears for the media, and its `mediaId` matches the ID shown in the FastPix dashboard.

If the row doesn't appear, the event log shows where processing stopped:

```sql
select "type", "processStatus", "lastError" from fastpix.webhook_events
order by "receivedAt" desc limit 10;
```

For how to interpret the result, see [Troubleshoot](#troubleshoot).

> **NOTE:**
>
> - Column names match the FastPix API, so they're camelCase and require double quotes in SQL. Use `select "mediaId" from fastpix.media`, not `select mediaId`.

> - The `fastpix` schema isn't exposed in the `[api]` section of `config.toml`. The service role writes these tables, and your client can't read them until you expose a safe view. For more information, see [Secure the tables](#secure-the-tables).

## Understand how syncing works

Most FastPix integrations need to save data into a database. You can add videos to FastPix in the following ways:

- Upload them directly with the Direct Uploads API.
- Provide a URL that points to a publicly available video file.
- Upload them in the FastPix dashboard.

When you upload a video or audio file to FastPix, it becomes a media asset.

### What the integration stores

An application typically saves FastPix information such as the media ID, playback ID, duration, and aspect ratio. `@fastpix/supabase` saves all of this for you under the `fastpix` schema.

An application also tracks information that FastPix doesn't own, such as the following:

- Which user uploaded the video.
- Structural details, such as whether the video belongs to a series or relates to other videos.
- Presentation details, such as descriptions, summaries, and chapter markers.
- Which users can view the video.

`@fastpix/supabase` doesn't save this kind of information, because it's an application-level concern.

> **NOTE:** \
> FastPix media includes a `metadata` field, which the integration saves to the `metadata` JSON column in the `media` table. Higher-level concepts such as titles, chapters, and permissions remain application-level concerns.

### How webhooks are processed

The integration stores webhooks first and processes them second. `fastpix-webhook` verifies the signature and puts the event on the queue, and `fastpix-worker` drains that queue. As a result, a failed projection never loses a delivery.

Events that carry only a fragment of a record, such as playback IDs, tracks, or simulcast targets, are recorded and acknowledged but not projected. FastPix sends a parent `video.media.updated` event afterward that carries the whole record. The nightly reconcile is the backstop for anything that never arrives.

## Backfill and reconcile data

If your FastPix account already contains media or live streams, backfill them into your Supabase database:

```bash
npx @fastpix/supabase backfill
```

The command prompts you for the database URL where it stores the data, and for your FastPix token ID and secret. To sync a single object type, pass it as an argument:

```bash
npx @fastpix/supabase backfill media
npx @fastpix/supabase backfill live_streams
```

Backfill saves its place as it goes, so if it stops, you can run it again and it continues from where it left off.

To heal webhooks that you missed, re-fetch resources that were active in the last _N_ hours:

```bash
npx @fastpix/supabase reconcile        # last 24 hours
npx @fastpix/supabase reconcile 48     # last 48 hours
```

### Use the sync engine directly

If you'd rather not use the CLI, call the sync engine from your own code:

```typescript
import { FastPixSync } from "@fastpix/fp-sync-engine";

const fastpixSync = new FastPixSync({
  databaseUrl: "your-supabase-database-url",
  fastpixTokenId: "your-fastpix-token-id",
  fastpixTokenSecret: "your-fastpix-token-secret",
  fastpixWebhookSecret: "your-fastpix-webhook-secret",
});

// Backfill all data.
await fastpixSync.syncBackfill({ object: "all" });

// Backfill specific object types.
await fastpixSync.syncBackfill({ object: "media" });
await fastpixSync.syncBackfill({ object: "live_streams" });

// Reconcile resources active in the last 24 hours.
const result = await fastpixSync.reconcileRecent({ sinceHours: 24 });
console.log(
  `Reconciled ${result.media} media, ${result.liveStreams} live streams`,
);
```

## Trigger a function when an event syncs

You can trigger your own Edge Function when a specific event finishes syncing. For example, you can run content moderation when a media asset becomes ready.

Workflows run on the pgmq queue and the Supabase Cron jobs that `init` already created, so complete the [local setup](#set-up-the-integration-locally) first. You only need to map an event type to one or more function names.

1. Define the workflow with the `FASTPIX_WORKFLOWS` secret:

   ```bash
   npx supabase secrets set FASTPIX_WORKFLOWS='{"video.media.ready":["content-moderation"]}'
   ```

   With this mapping, when the `video.media.ready` event fires and the `fastpix.media` row is already current, the integration runs your Edge Function named `content-moderation`.

2. Create the function:

   ```bash
   npx supabase functions new content-moderation
   ```

3. Open `supabase/functions/content-moderation/index.ts` and add your handler. Your function receives `{ eventId, type, objectType, objectId }`.

   ```typescript
   Deno.serve(async (req) => {
     try {
       const { objectId } = await req.json();
       if (!objectId) {
         console.log("No objectId in payload");
         return new Response("No objectId in payload", { status: 500 });
       }

       console.log(`Running moderation for media: ${objectId}`);
       // The fastpix.media row for objectId is already up to date.
       // Call APIs, write to your database, or run other logic here.
       return new Response("Moderation complete", { status: 200 });
     } catch (error) {
       console.error("Error running content-moderation.ts:", error);
       return new Response(JSON.stringify({ error: "500" }), {
         status: 500,
         headers: { "Content-Type": "application/json" },
       });
     }
   });
   ```

4. Register the function in `config.toml` with `verify_jwt = true`, because the worker sends the service-role key:

   ```toml
   [functions.content-moderation]
   verify_jwt = true
   ```

**Caution:** Dispatch is at-least-once, so your function might run more than once for the same event. Make it safe to repeat.

### Test a workflow

Run `npx supabase functions serve` to execute all of your functions, then create a media asset either programmatically or by uploading a video in the FastPix dashboard. When the media becomes ready for playback, the `video.media.ready` event fires and your `content-moderation` function runs.

## Deploy to production

1. Link your project:

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   ```

2. Run the migrations. `db push` applies the queue and cron migrations, and `migrate` creates the `fastpix` tables. Find your connection string in the dashboard under **Connect**.

   ```bash
   npx supabase db push
   SUPABASE_DB_URL='postgresql://…' npx @fastpix/supabase migrate
   ```

3. Add the Vault secrets that the cron jobs need. In the dashboard, open the SQL Editor and run the following:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'fastpix_functions_url');
   select vault.create_secret('<service-role-key>', 'fastpix_service_role_key');
   ```

   Re-running these statements after the secrets exist fails with a duplicate key error. To change a value, update it instead:

   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'fastpix_service_role_key'), '<new-key>');
   ```

4. Set the secrets for your Edge Functions, either manually in the dashboard or from your `.env` file. Confirm that `supabase/functions/.env` holds the correct credentials first.

   ```bash
   npx supabase secrets set --env-file ./supabase/functions/.env
   npx supabase secrets list
   ```

5. Push the config. This step sends the `verify_jwt` settings. Without it, the webhook returns `401`.

   ```bash
   npx supabase config push
   ```

6. Deploy the functions:

   ```bash
   npx supabase functions deploy
   ```

7. Set up the production webhook. After you deploy `fastpix-webhook`, its URL appears in the dashboard under **Edge Functions**. As in [Run the webhook locally](#run-the-webhook-locally), create a webhook in FastPix with that URL, then set `FASTPIX_WEBHOOK_SECRET` in the Supabase dashboard to the new value.

8. [Secure the tables](#secure-the-tables). They're unsecured until you do.

## Secure the tables

**Warning:** Until you complete this section, the `fastpix` tables have no row-level security. `live_streams` holds `streamKey` and `srtSecret`, which let anyone stream into your account, and `webhook_events` stores raw payloads that can contain those same secrets. Never expose either table to your client.

In the SQL Editor, grant access to the service role and enable row-level security on every table:

```sql
grant usage on schema fastpix to service_role;
grant all on all tables in schema fastpix to service_role;
alter default privileges in schema fastpix grant all on tables to service_role;

alter table fastpix.webhook_events enable row level security;
alter table fastpix.media          enable row level security;
alter table fastpix.live_streams   enable row level security;
alter table fastpix.uploads        enable row level security;
alter table fastpix.sync_state     enable row level security;
```

Enabling row-level security with no policies denies everyone except the service role, which is the safe default. To show data in your app, create a view that exposes only the safe columns.

## Upgrade the engine

Each generated function is a three-line entry point that imports its handler from `@fastpix/supabase/deno`, pinned to an exact version in that function's `deno.json`. That pin, not your `package.json`, determines which engine your deployed webhooks run.

Because `init` never overwrites existing files, upgrading the package doesn't update functions that you already have. If the pin and your installed package disagree, the CLI commands run the new engine while your webhooks still run the old one.

To upgrade, do one of the following:

- Bump the version pin in each function's `deno.json` by hand.
- Delete the four function directories and re-run `npx @fastpix/supabase init`.

After you upgrade `@fastpix/fp-sync-engine`, run `migrate`, because an engine upgrade can change column types:

```bash
npx @fastpix/supabase migrate
```

## CLI reference

| Command                                                | Description                                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx @fastpix/supabase init`                           | Creates the schema, the four Edge Functions, the pgmq queue, and the cron jobs, then prompts for credentials. Copy-if-absent, so it's safe to re-run. |
| `npx @fastpix/supabase backfill [media\|live_streams]` | Imports existing FastPix records. Omit the argument to import everything. Resumable.                                                                  |
| `npx @fastpix/supabase reconcile [hours]`              | Re-fetches resources active in the last _N_ hours. Defaults to 24.                                                                                    |
| `npx @fastpix/supabase migrate`                        | Creates or updates the `fastpix` tables without copying any files. Run after an engine upgrade.                                                       |

## Environment variable reference

Set the following variables in `supabase/functions/.env` for local development, and with `npx supabase secrets set` in production.

| Variable                 | Required by                 | Description                                                                                                                                                              |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FASTPIX_WEBHOOK_SECRET` | All four functions          | The FastPix webhook signing secret, used to verify request signatures. Copy it from the FastPix dashboard.                                                               |
| `FASTPIX_TOKEN_ID`       | Worker, reconcile, backfill | The FastPix API token ID, used to re-fetch records.                                                                                                                      |
| `FASTPIX_TOKEN_SECRET`   | Worker, reconcile, backfill | The FastPix API token secret.                                                                                                                                            |
| `FASTPIX_WORKFLOWS`      | Worker                      | Optional. A JSON map of event types to Edge Function names. For more information, see [Trigger a function when an event syncs](#trigger-a-function-when-an-event-syncs). |
| `SUPABASE_DB_URL`        | The `migrate` command       | The Postgres connection string. Supabase injects this into Edge Functions. Find it in the dashboard under **Connect**.                                                   |

The following secrets live in Supabase Vault rather than in your environment:

| Secret                     | Description                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `fastpix_functions_url`    | The base URL that the cron jobs call. Use `http://host.docker.internal:54321/functions/v1` locally. |
| `fastpix_service_role_key` | The service-role key that the cron jobs send as a bearer token.                                     |

## Troubleshoot

**No rows in `fastpix.webhook_events`.** FastPix isn't reaching your webhook. Check that your tunnel URL is current and that the webhook secret in FastPix matches `FASTPIX_WEBHOOK_SECRET`.

**Rows stuck at `received`.** Nothing is draining the queue. Confirm that both Vault secrets exist and hold the correct values. See [Create the Vault secrets](#create-the-vault-secrets).

**The webhook returns 401 in production.** You didn't push the config, so `verify_jwt` is still `true` for `fastpix-webhook`. Run `npx supabase config push`.

**The cron jobs report bearer token errors.** The `fastpix_service_role_key` Vault secret is missing or wrong. In the dashboard, go to **Integrations** > **Vault** and check its value. Vault values load when migrations are applied.

To test while ignoring JWT verification, serve the functions with verification disabled:

```bash
npx supabase functions serve --no-verify-jwt
```

**`config.toml` changes have no effect.** Restart your local instance with `npx supabase stop` and `npx supabase start`.

**`vault.create_secret` fails with a duplicate key error.** The secret already exists. Update it instead of creating it. See step 3 of [Deploy to production](#deploy-to-production).

**A SQL query returns a column-not-found error.** Column names are camelCase and need double quotes: `select "mediaId" from fastpix.media`.
