// fastpix-backfill — one-off initial import (M7). Paginates the FastPix API and upserts every
// existing media + live stream, so the mirror catches up on everything created before webhooks were
// wired up. Invoke manually (not on a schedule):
//   curl -X POST "$FUNCTIONS_URL/fastpix-backfill" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
//        -H 'Content-Type: application/json' -d '{"object":"all"}'
//
// Resumable: the core checkpoints its cursor in fastpix.sync_state, so a re-invoke continues.
// NOTE: not unit-tested here (needs the stack); backfill logic is tested in the core (backfill.test.ts).
import { json, sync } from "./shared.ts";

// Backfill also pulls in entities each record references (recorded VODs, etc.). Keyed separately in
// the memo so the other three handlers never get a client carrying this flag.
const BACKFILL_OPTS = { backfillRelatedEntities: true };

export async function backfill(req: Request): Promise<Response> {
  // Body: { object: 'all' | 'media' | 'live_streams' }. Defaults to 'all'.
  let object: "all" | "media" | "live_streams" = "all";
  try {
    const body = await req.json();
    if (
      body?.object === "media" ||
      body?.object === "live_streams" ||
      body?.object === "all"
    )
      object = body.object;
  } catch {
    /* no/invalid body -> default 'all' */
  }

  await sync(BACKFILL_OPTS).syncBackfill({ object });
  return json({ backfilled: object });
}
