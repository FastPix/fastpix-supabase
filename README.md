# @fastpix/supabase

`@fastpix/supabase` contains a CLI for integrating your FastPix account with your Supabase account. Setting this up will:

1. Create a `fastpix` schema that contains tables for:
   - `media` ([Media](https://docs.fastpix.io))
   - `live_streams` ([Live Streams](https://docs.fastpix.io))
   - `uploads` ([Direct Uploads](https://docs.fastpix.io))
   - `webhook_events` (Webhook events)
   - `sync_state` (Backfill/reconcile bookkeeping)
2. Set up edge functions for receiving webhooks and keeping data in the `fastpix` schema up-to-date

## Getting started

**Dependencies**

Before setting this up, you should already have Supabase initialized in your project (your project should already have a `supabase` directory). If you have not already done this, run `npx supabase init` and see [this guide](https://supabase.com/docs/reference/cli/supabase-init).

**Local Setup**

You should run this after your supabase project is running with `npx supabase start`

Run init and follow the prompts. Then env vars should be in the `.env` file within the `supabase/functions` directory.

```bash
npx @fastpix/supabase init
```

This will:

- Create the `fastpix` schema and corresponding tables
- Create four functions in `/supabase/functions` (`fastpix-webhook`, `fastpix-worker`, `fastpix-reconcile`, `fastpix-backfill`) which use the `@fastpix/fp-sync-engine` package to sync your data
- Set up a pgmq job queue and two Supabase Cron jobs (drain + nightly reconcile) that drive the sync
- Prompt you to configure the `FASTPIX_TOKEN_ID`, `FASTPIX_TOKEN_SECRET`, and `FASTPIX_WEBHOOK_SECRET`
- Set `verify_jwt` for each function in `config.toml` (the webhook is set to `false` because FastPix signs requests instead of sending a Supabase JWT)
  - If Supabase is already running, you need to restart the instance (`supabase stop` and `supabase start`) for the `config.toml` changes to take effect properly

Everything `init` writes is copy-if-absent, so re-running it is safe and will never overwrite a file you have edited.

**Vault secrets**

The two cron jobs call your edge functions over HTTP and read the URL and key from Supabase Vault, so they are never committed in a migration. Until these exist the queue fills but nothing drains, and nothing reports an error. In the SQL Editor:

```sql
select vault.create_secret('http://host.docker.internal:54321/functions/v1', 'fastpix_functions_url');
select vault.create_secret('<SERVICE_ROLE_KEY>', 'fastpix_service_role_key');
```

Locally the URL must be reachable from inside the Postgres container, so use `host.docker.internal` rather than `localhost`. Your service-role key is in `npx supabase status -o env`.

**Running the Webhook locally**

`@fastpix/supabase` handles webhooks & keeping data updated in the `fastpix` schema.

To test the webhook locally, run:

```bash
npx supabase functions serve
```

This will run the Edge functions locally on port 54321. To test with FastPix, you need to expose the function to the internet. Use a service like ngrok for this.

Once done, get the public URL of your function (it should have a format like `https://d99d3b847eb8.ngrok-free.app/functions/v1/fastpix-webhook`) and set it in FastPix under **Org Settings → Webhooks → Create new webhook**.

After that, copy the webhook secret from FastPix into `FASTPIX_WEBHOOK_SECRET` in your `.env` file.

**Verify that it's working**

Go to your FastPix dashboard, make sure you're in the correct environment and upload a media asset. Then navigate to your local Supabase dashboard and you should see a row for the media in the `fastpix` schema `media` table and the `mediaId` should match the ID for the media in the FastPix dashboard.

If the row doesn't appear, the event log tells you where it stopped:

```sql
select "type", "processStatus", "lastError" from fastpix.webhook_events
order by "receivedAt" desc limit 10;
```

No rows means FastPix isn't reaching your webhook — check the tunnel URL and the webhook secret. Rows stuck at `received` mean nothing is draining the queue, so check the Vault secrets above.

> Column names match the FastPix API, so they are camelCase and need double quotes in SQL: `select "mediaId" from fastpix.media` — not `select mediaId`.

> The `fastpix` schema is not exposed in the `[api]` section of `config.toml`. These tables are written by the service role and are not readable from your client until you expose a safe view — see step 8 of Production Deployment.

## Backfilling Existing Data

If you already have FastPix media or live streams in your account, you can backfill them to your Supabase database using the CLI command:

```bash
npx @fastpix/supabase backfill
```

This will prompt you for the database URL where it will store the data and your FastPix token and secret to sync the data. Add `media` or `live_streams` to sync just one type. It saves its place as it goes, so if it stops you can run it again and it continues.

You can also heal any webhooks you missed by re-fetching resources active in the last N hours (24 by default):

```bash
npx @fastpix/supabase reconcile        # last 24h
npx @fastpix/supabase reconcile 48     # last 48h
```

There is also a `migrate` command, which creates or updates the `fastpix` tables without copying any files. Run it after upgrading `@fastpix/fp-sync-engine`, since an engine upgrade can change column types:

```bash
npx @fastpix/supabase migrate
```

Each generated function is a three-line entry point that imports its handler from `@fastpix/supabase/deno`, pinned to an exact version in that function's `deno.json` — that pin, not your `package.json`, decides which engine your deployed webhooks run. Because `init` never overwrites existing files, upgrading the package does not update the functions you already have: bump those pins by hand, or delete the four directories and re-run `init`. If the two disagree, the CLI commands run the new engine while your webhooks still run the old one.

If you prefer not to use the command, you can use the sync-engine directly:

```typescript
import { FastPixSync } from "@fastpix/fp-sync-engine";

const fastpixSync = new FastPixSync({
  databaseUrl: "your-supabase-database-url",
  fastpixTokenId: "your-fastpix-token-id",
  fastpixTokenSecret: "your-fastpix-token-secret",
  fastpixWebhookSecret: "your-fastpix-webhook-secret",
});

// Backfill all data
await fastpixSync.syncBackfill({ object: "all" });

// Backfill specific object types
await fastpixSync.syncBackfill({ object: "media" });
await fastpixSync.syncBackfill({ object: "live_streams" });

// Reconcile resources active in the last 24h
const result = await fastpixSync.reconcileRecent({ sinceHours: 24 });
console.log(
  `Reconciled ${result.media} media, ${result.liveStreams} live streams`,
);
```

## Core Concepts

Most FastPix integrations require **saving data into a database**. The general flow to use FastPix is:

- Videos can be uploaded directly to FastPix with the Direct Uploads API
- Videos can be uploaded with a URL pointing to a publicly available video file
- Videos can be uploaded directly in the FastPix dashboard

When a video (or audio file) is uploaded to FastPix, it becomes a media asset.

### Saving data associated with each video

When saving data into a database, typically the application would save information about the FastPix media, like:

- Media ID
- Playback ID
- Duration
- Aspect ratio

`@fastpix/supabase` will save all this data for you under the `fastpix` schema.

In addition to the information from FastPix, the application also keeps track of things like:

- Which user uploaded the video
- Structural/organization things, like if the video is part of a series or related to other videos
- Video details like: description, summary, chapter markers, etc.
- Who has access to view the video

`@fastpix/supabase` does not save this kind of information, which is an application-level concern.

> FastPix media has a `metadata` field which will be saved under the `metadata` JSON column in the `media` table. Higher-level concepts (titles, chapters, permissions, etc.) are still considered application-level concerns.

Webhooks are stored first and processed second: `fastpix-webhook` verifies the signature and puts the event on the queue, and `fastpix-worker` drains that queue. A delivery is never lost because a projection failed. Events that carry only a fragment of a record — playback IDs, tracks, simulcast targets — are recorded and acknowledged but not projected, because FastPix sends a parent `video.media.updated` afterwards that carries the whole record. The nightly reconcile is the backstop for anything that never arrived.

## Workflows on Supabase

You can trigger your own edge function when a specific event finishes syncing — for example, running content moderation when a media asset becomes ready.

**Env setup**

Workflows run on the pgmq queue and Supabase Cron jobs, which `init` already set up. You only have to map an event type to one or more function names with the `FASTPIX_WORKFLOWS` secret. You should only run this after you have gone through the `@fastpix/supabase init` flow.

Define a workflow and when it should run:

```bash
npx supabase secrets set FASTPIX_WORKFLOWS='{"video.media.ready":["content-moderation"]}'
```

This means that when the `video.media.ready` event fires (and the `fastpix.media` row is already up to date), it will run your Supabase Edge Function called `content-moderation`.

Create the Supabase Edge Function:

```bash
npx supabase functions new content-moderation
```

Open up `supabase/functions/content-moderation/index.ts`

```tsx
Deno.serve(async (req) => {
  try {
    const { objectId } = await req.json();
    if (!objectId) {
      console.log("No objectId in payload");
      return new Response("No objectId in payload", { status: 500 });
    }

    console.log(`Running moderation for media: ${objectId}`);
    // The fastpix.media row for objectId is already up to date.
    // do your logic to make API calls, write data into your db, etc
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

Your function receives `{ eventId, type, objectType, objectId }`.

Add it to `config.toml` with `verify_jwt = true` (the worker sends the service role key):

```toml
[functions.content-moderation]
verify_jwt = true
```

**Testing**

To test, run `supabase functions serve`, this will execute all created functions and then try creating a media asset and see that your content-moderation function runs. This will trigger the `video.media.ready` event when the media is ready for playback. You can do this either by creating a media asset programmatically, or by uploading a video directly in the FastPix dashboard.

Dispatch is at-least-once, so your function may run more than once for the same event — make it safe to repeat.

**Troubleshooting**

If the Cron returns bearer token issues, make sure you have properly set the `fastpix_service_role_key` in the vault with the `SERVICE_ROLE_KEY`.

You can find this in the Supabase dashboard under Integrations → Vault and check what value is set for `fastpix_service_role_key`. Note that vault values are loaded/modified when migrations are applied.

In any case, if you want to test ignoring this, you can run the functions with JWT verification disabled using the command:

```bash
npx supabase functions serve --no-verify-jwt
```

## Production Deployment

To deploy to a Supabase project, you need to do the following:

**1. Link your project:**

```bash
npx supabase login
npx supabase link --project-ref <ref>
```

**2. Run migrations:**

Once linked, run the migrations in your project with the command:

```bash
npx supabase db push
SUPABASE_DB_URL='postgresql://…' npx @fastpix/supabase migrate
```

`db push` applies the queue/cron migrations; `migrate` creates the `fastpix` tables (the connection string is under Dashboard → Connect).

**3. Add the Vault secrets** the cron jobs need, in Dashboard → SQL Editor:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'fastpix_functions_url');
select vault.create_secret('<service-role-key>', 'fastpix_service_role_key');
```

Re-running these errors with a duplicate key once they exist. To change a value, update it instead:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'fastpix_service_role_key'), '<new-key>');
```

**4. Set secrets for Edge Functions:**

You can do this in 2 ways:

- Set manually in the Dashboard
- Run the command:

```bash
npx supabase secrets set --env-file ./supabase/functions/.env
npx supabase secrets list
```

Make sure you have the `.env` file in the functions folder with your correct credentials.

**5. Push config:**

```bash
npx supabase config push
```

This sends the `verify_jwt` settings — without it the webhook returns 401.

**6. Deploy functions:**

Once ready, deploy the functions with:

```bash
npx supabase functions deploy
```

**7. Set up the webhook:**

When everything is ready, we need to properly set the `FASTPIX_WEBHOOK_SECRET`. Once the fastpix-webhook is deployed in Supabase, the URL will appear in Dashboard → Edge Functions.

Similar to the "Running the Webhook locally" section, create the webhook in FastPix with that URL and set the `FASTPIX_WEBHOOK_SECRET` in the Supabase Dashboard with the new value.

**8. Lock down the tables** (they are unsecured until you do), in the SQL Editor:

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

Enabling RLS with no policies denies everyone except the service role, which is the safe default. To show data in your app, make a view of only the safe columns.

Don't expose `live_streams` — it holds `streamKey` and `srtSecret`, which let anyone stream into your account. `webhook_events` needs the same care, since raw payloads can contain those same secrets.
