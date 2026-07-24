// fastpix-webhook — ingest handler (Deno).
// Verify (raw body) -> dedup-insert via the core -> enqueue a pgmq job -> 202.
// Always 202 for a signature-valid event so FastPix stops its up-to-30x retries; correctness
// is handled async + idempotently by the worker (M2).
//
// NOTE: not unit-tested here — needs the running Supabase stack. The verify + dedup logic it
// calls (core ingestWebhook) IS tested in @fastpix/fp-sync-engine.
import { InvalidSignatureError } from "@fastpix/fp-sync-engine";
import { sql, sync } from "./shared.ts";

export async function webhook(req: Request): Promise<Response> {
  // FastPix (and uptime probes) validate the URL with a GET/HEAD reachability check — answer 200
  // so the endpoint registers as reachable. Only POST carries a real signed webhook.
  if (req.method === "GET" || req.method === "HEAD")
    return new Response("ok", { status: 200 });
  if (req.method !== "POST")
    return new Response("method not allowed", { status: 405 });

  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers);

  // FastPix validates a new webhook URL with a reachability PING that carries NO signature header
  // (a real event always signs with `fastpix-signature`). Answer 200 so the URL registers as
  // reachable, but do NOT process it. A POST that DOES carry a signature still gets verified below,
  // so a genuine wrong-secret misconfig is never masked (it 401s, not silently 200s).
  const hasSignature = Object.keys(headers).some(
    (k) => k.toLowerCase() === "fastpix-signature",
  );
  if (!hasSignature) return new Response("ok", { status: 200 });

  let result;
  try {
    result = await sync().ingestWebhook(rawBody, headers);
  } catch (e) {
    if (e instanceof InvalidSignatureError) {
      return new Response("invalid signature", { status: 401 }); // do not store, do not enqueue
    }
    // Pre-insert failure (DB down, malformed body): 5xx so FastPix retries. Don't 202 — we
    // haven't durably stored the event yet.
    console.error("ingest failed", (e as Error).message); // message only — never the raw body (R9)
    return new Response("ingest error", { status: 500 });
  }

  // Stored exactly once (R2): enqueue only the first time this id is seen.
  if (!result.isDuplicate) {
    const db = sql();
    await db`select pgmq.send('fastpix_jobs', ${db.json({ eventId: result.eventId })})`;
  }
  return new Response(null, { status: 202 });
}
