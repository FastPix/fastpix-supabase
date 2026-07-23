// `fastpix-supabase backfill [object]` — import existing media / live streams from the FastPix API.
// Runs locally against Postgres, so it isn't bound by an Edge Function's time limit.
import { FastPixSync } from "@fastpix/fp-sync-engine";
import {
  ok,
  die,
  ask,
  requireDatabaseUrl,
  applyQueueMigrations,
} from "./utils.mjs";

export async function backfill(object = "all") {
  if (!["all", "media", "live_streams"].includes(object)) {
    die(`Unknown object '${object}'. Expected: all | media | live_streams`);
  }
  const databaseUrl = await requireDatabaseUrl();
  const fastpixTokenId =
    process.env.FASTPIX_TOKEN_ID || (await ask("FASTPIX_TOKEN_ID: "));
  const fastpixTokenSecret =
    process.env.FASTPIX_TOKEN_SECRET || (await ask("FASTPIX_TOKEN_SECRET: "));
  if (!fastpixTokenId || !fastpixTokenSecret) {
    die(
      "Backfill re-fetches every record from the API, so it needs a token id and secret.",
    );
  }

  const sync = new FastPixSync({
    databaseUrl,
    fastpixTokenId,
    fastpixTokenSecret,
    fastpixWebhookSecret: "", // backfill reads the list APIs; it never verifies a signature
    backfillRelatedEntities: true,
  });
  try {
    console.log(`Backfilling ${object}…`);
    // Checkpoints its cursor to fastpix.sync_state after every page, so an interrupted run resumes.
    const result = await sync.syncBackfill({ object });
    // syncBackfill resolves to undefined today — the engine logs per-resource counts itself, and
    // JSON.stringify(undefined) is undefined, which printed a literal "Backfill complete undefined".
    // Stays correct automatically if a future engine returns totals.
    ok(`Backfill complete${result ? ` ${JSON.stringify(result)}` : ""}`);
  } catch (e) {
    // A stack trace here is nearly always just bad credentials. Message only, never a response body.
    console.error(`❌ Backfill failed — ${e.message}`);
    if (String(e.message).includes("401")) {
      console.error(
        "   A 401 means the token id/secret are wrong or lack API access.",
      );
    }
    process.exitCode = 1;
  } finally {
    await sync.close(); // release the pool or node hangs on exit
  }
}

// `fastpix-supabase reconcile [hours]` — re-fetch resources active in the last [hours] (default 24)
// and heal any drift, including deletions. Same local, no-time-limit path as backfill; the nightly
// fastpix-reconcile edge function calls the same core method.
export async function reconcile(hours) {
  const sinceHours = hours === undefined ? 24 : Number(hours);
  if (!Number.isFinite(sinceHours) || sinceHours <= 0) {
    die(`Invalid hours '${hours}'. Pass a positive number, e.g. reconcile 48`);
  }
  const databaseUrl = await requireDatabaseUrl();
  const fastpixTokenId =
    process.env.FASTPIX_TOKEN_ID || (await ask("FASTPIX_TOKEN_ID: "));
  const fastpixTokenSecret =
    process.env.FASTPIX_TOKEN_SECRET || (await ask("FASTPIX_TOKEN_SECRET: "));
  if (!fastpixTokenId || !fastpixTokenSecret) {
    die(
      "Reconcile re-fetches every recent record from the API, so it needs a token id and secret.",
    );
  }

  const sync = new FastPixSync({
    databaseUrl,
    fastpixTokenId,
    fastpixTokenSecret,
    fastpixWebhookSecret: "", // reconcile reads the get APIs; it never verifies a signature
    backfillRelatedEntities: true,
  });
  try {
    console.log(`Reconciling resources active in the last ${sinceHours}h…`);
    const result = await sync.reconcileRecent({ sinceHours });
    ok(`Reconcile complete ${JSON.stringify(result)}`);
  } catch (e) {
    console.error(`❌ Reconcile failed — ${e.message}`);
    if (String(e.message).includes("401")) {
      console.error(
        "   A 401 means the token id/secret are wrong or lack API access.",
      );
    }
    process.exitCode = 1;
  } finally {
    await sync.close();
  }
}

export async function migrate() {
  const databaseUrl = await requireDatabaseUrl();
  await applyQueueMigrations(databaseUrl);
  const { runMigrations } = await import("@fastpix/fp-sync-engine");
  await runMigrations({ databaseUrl });
  ok("fastpix schema and tables are up to date");
}
