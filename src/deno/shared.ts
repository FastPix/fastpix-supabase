// Shared lazy singletons for the four edge-function handlers.
//
// All four handlers ship in ONE bundle (`@fastpix/supabase/deno`), so anything constructed at module
// scope would run in every function: importing the webhook handler would also open the worker's
// connection and demand the worker's env vars. Everything here is therefore built on first use and
// memoised per isolate, which is the same "once per instance" behaviour the separate files had.
import { FastPixSync } from "@fastpix/fp-sync-engine";
import postgres from "postgres";

export const env = (key: string) => Deno.env.get(key);

export const databaseUrl = () => env("SUPABASE_DB_URL")!;

let _sql: ReturnType<typeof postgres> | undefined;
/** pgmq read/send/delete/archive. Supabase-specific, so it lives here rather than in the core. */
export const sql = () => (_sql ??= postgres(databaseUrl()));

const syncs = new Map<string, FastPixSync>();
/**
 * A core client. `extra` is keyed into the memo, so backfill's `backfillRelatedEntities` variant
 * does not leak into the reconcile/worker/webhook clients that must not have it.
 */
export function sync(extra: Record<string, unknown> = {}): FastPixSync {
  const key = JSON.stringify(extra);
  let client = syncs.get(key);
  if (!client) {
    client = new FastPixSync({
      databaseUrl: databaseUrl(),
      fastpixWebhookSecret: env("FASTPIX_WEBHOOK_SECRET")!,
      // The worker's R4 re-fetches and every backfill/reconcile page need the API creds, or each
      // call sends empty Basic auth and 401s into the dead-letter.
      fastpixTokenId: env("FASTPIX_TOKEN_ID"),
      fastpixTokenSecret: env("FASTPIX_TOKEN_SECRET"),
      ...extra,
    });
    syncs.set(key, client);
  }
  return client;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
