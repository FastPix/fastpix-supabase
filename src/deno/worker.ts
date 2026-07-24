// fastpix-worker — drains the pgmq queue and processes each job via the core (M2 skeleton).
// Invoked on a schedule / by the queue; reads a batch, calls processStoredEvent, deletes the
// message on success. On failure it leaves the message on the queue so pgmq's visibility timeout
// re-delivers it, and archives it past the read cap so a poison job cannot redeliver forever (M6).
//
// Workflow dispatch: once an event has synced, the worker re-enqueues one {eventId, workflow} job
// per edge function mapped to that event type in FASTPIX_WORKFLOWS — onto the SAME queue. Dispatch
// therefore inherits the queue's 30s visibility timeout, its retry cap and its cron for free, and
// because it is enqueued only after processStoredEvent returns, the mirror tables are already
// current when the user's function reads.
//
// NOTE: not unit-tested here (needs the running stack). The routing/classification it drives is
// unit-tested in @fastpix/fp-sync-engine (router/ordering/worker tests).
import { env, json, sql, sync } from "./shared.ts";

type Job = {
  eventId: string;
  workflow?: string; // absent => sync job (the shape this queue has always carried)
  type?: string;
  objectType?: string | null;
  objectId?: string | null;
};

// eventType -> edge function names, e.g. {"video.media.ready":["generate-captions"]}. Read per
// invocation, deliberately WITHOUT a try/catch: a malformed value should fail loudly rather than
// silently dispatching nothing forever. Unset = the feature is inert.
const readWorkflows = (): Record<string, string[]> =>
  JSON.parse(env("FASTPIX_WORKFLOWS") ?? "{}");

// POST the event to the user's edge function. Non-2xx throws, so the caller's catch leaves the
// message queued for the normal redelivery/archive path. The 10s timeout stops one hung workflow
// from eating the whole batch's wall clock, and must stay well under the 30s visibility timeout.
async function dispatch(job: Job): Promise<void> {
  // Both injected by the Edge runtime — they are not secrets you set.
  const res = await fetch(
    `${env("SUPABASE_URL")}/functions/v1/${job.workflow}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        eventId: job.eventId,
        type: job.type,
        objectType: job.objectType,
        objectId: job.objectId,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  await res.body?.cancel(); // release the connection; never read or log the body (R9)
  if (!res.ok) throw new Error(`workflow returned ${res.status}`);
}

export async function worker(): Promise<Response> {
  const db = sql();
  const core = sync();
  const workflows = readWorkflows();
  const hasWorkflows = Object.keys(workflows).length > 0;
  // Deliveries before a job is archived instead of retried, configurable via the environment.
  const maxReadCt = Number(env("FASTPIX_MAX_READ_CT") ?? 7);

  // read(queue, visibility_timeout_seconds, batch_size)
  const msgs = await db<{ msg_id: number; read_ct: number; message: Job }[]>`
    select msg_id, read_ct, message from pgmq.read('fastpix_jobs', 30, 10)
  `;

  // One batched lookup for the whole tick rather than one per message, and skipped entirely when
  // no workflows are configured — that is what keeps this free for users who never opt in.
  const syncIds = msgs
    .filter((m) => !m.message.workflow)
    .map((m) => m.message.eventId);
  const events =
    hasWorkflows && syncIds.length > 0
      ? await db<
          {
            id: string;
            type: string;
            objectType: string | null;
            objectId: string | null;
          }[]
        >`
        select "id", "type", "objectType", "objectId"
        from fastpix.webhook_events where "id" in ${db(syncIds)}
      `
      : [];
  const byId = new Map(events.map((e) => [e.id, e]));

  let processed = 0;
  for (const m of msgs) {
    try {
      if (m.message.workflow) {
        await dispatch(m.message);
      } else {
        await core.processStoredEvent(m.message.eventId);
        const ev = byId.get(m.message.eventId);
        const targets = (ev && workflows[ev.type]) || [];
        if (ev && targets.length > 0) {
          // processStoredEvent RECORDS failures on the row instead of throwing (R4), so a 401 from
          // the API still returns normally — the row, not the return value, is the authority on
          // whether the mirror is current. The return value cannot be used: on success it carries
          // the entity status, so a healthy `video.media.failed` event also returns 'failed'.
          const [after] = await db<{ processStatus: string }[]>`
            select "processStatus" from fastpix.webhook_events where "id" = ${m.message.eventId}
          `;
          if (after?.processStatus === "processed") {
            // Enqueued after the sync commits and before the delete: a crash in this window
            // redelivers the sync job and re-enqueues, which is at-least-once — the alternative
            // (enqueue after the delete) can lose a dispatch entirely.
            for (const workflow of targets) {
              await db`select pgmq.send('fastpix_jobs', ${db.json({
                eventId: ev.id,
                workflow,
                type: ev.type,
                objectType: ev.objectType,
                objectId: ev.objectId,
              })})`;
            }
          } else {
            // Never dispatch off a stale mirror. Reconcile heals the row; it does not re-dispatch.
            console.error(
              "worker: dispatch skipped, event not processed",
              m.message.eventId,
              after?.processStatus ?? "missing",
            );
          }
        }
      }
      await db`select pgmq.delete('fastpix_jobs', ${m.msg_id}::bigint)`; // ::bigint: pgmq.delete is overloaded
      processed++;
    } catch (e) {
      // no payload, no response body (R9) — ids and a status/message only
      console.error(
        "worker: job failed",
        m.message.eventId,
        m.message.workflow ?? "sync",
        (e as Error).message,
      );
      if (m.read_ct > maxReadCt) {
        // Poison job: stop burning FastPix API quota / re-POSTing a broken workflow. The row stays
        // inspectable in pgmq.a_fastpix_jobs and in fastpix.webhook_events."lastError".
        await db`select pgmq.archive('fastpix_jobs', ${m.msg_id}::bigint)`; // ::bigint: overloaded
      }
      // otherwise left on queue -> redelivered after the visibility timeout.
    }
  }

  return json({ read: msgs.length, processed });
}
