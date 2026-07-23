// fastpix-reconcile — nightly cron target (M7). Re-fetches resources active in the last 24h and
// upserts the current API state, healing any webhooks we missed. Registered in
// 0003_fastpix_setup_cron_job.sql.
// NOTE: not unit-tested here (needs the stack); the reconcile logic is tested in the core
// (@fastpix/fp-sync-engine backfill.test.ts).
import { json, sync } from "./shared.ts";

export async function reconcile(): Promise<Response> {
  return json(await sync().reconcileRecent({ sinceHours: 24 }));
}
