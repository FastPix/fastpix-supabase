// Shared helpers for the CLI commands: console output, prompts, and locating the user's project.
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import postgres from "postgres";

// Resolved for both layouts: the published bundle (dist/index.js, migrations at dist/migrations)
// and a source checkout (src/commands/utils.mjs, migrations at src/migrations).
const HERE = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = fs.existsSync(path.join(HERE, "migrations"))
  ? path.join(HERE, "migrations")
  : path.resolve(HERE, "..", "migrations");

const ROOT = [path.resolve(HERE, ".."), path.resolve(HERE, "..", "..")].find(
  (dir) => fs.existsSync(path.join(dir, "package.json")),
);
/** Our own manifest — the generated deno.json import maps are pinned from its versions. */
export const PKG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
);

export const FUNCTIONS = [
  "fastpix-webhook",
  "fastpix-worker",
  "fastpix-reconcile",
  "fastpix-backfill",
];

/** `fastpix-webhook` -> `webhook`, the handler @fastpix/supabase/deno exports for it. */
export const handlerFor = (fn) => fn.replace(/^fastpix-/, "");

export const ok = (m) => console.log(`✅ ${m}`);
export const skip = (m) => console.log(`   ${m}`);
export const die = (m) => {
  console.error(`❌ ${m}`);
  process.exit(1);
};

/** Ask a question. Returns '' when stdin isn't a TTY, so CI and piped input can't hang. */
export async function ask(question) {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** The user's `supabase` directory, or exit with the command that creates it. */
export function supabaseDir() {
  const dir = path.join(process.cwd(), "supabase");
  if (!fs.existsSync(dir)) {
    die(
      "No `supabase` directory here. Run `npx supabase init` first, then run this from the same folder.",
    );
  }
  return dir;
}

export function resolveDatabaseUrl() {
  return process.env.SUPABASE_DB_URL || process.env.DB_URL || "";
}

export async function requireDatabaseUrl() {
  const url =
    resolveDatabaseUrl() ||
    (await ask("Database URL (`supabase status -o env` shows it as DB_URL): "));
  if (!url)
    die("No database URL. Set SUPABASE_DB_URL, or pass it when prompted.");
  return url;
}

/**
 * Apply the queue + cron migrations (`src/migrations/*.sql`) directly to the database.
 *
 * These create the `pgmq` extension, the `fastpix_jobs` queue, its RPC wrappers, and the two cron
 * jobs. The webhook enqueues onto that queue, so without them it fails with `schema "pgmq" does not
 * exist` and nothing reaches the `media` / `live_streams` / `uploads` tables. Copying the files into
 * `supabase/migrations` isn't enough — they have to be applied, which is what this does.
 *
 * Idempotent: if the queue already exists (e.g. `supabase db push` created it in production), it
 * skips. Safe to run from both `init` and `migrate`.
 */
export async function applyQueueMigrations(databaseUrl) {
  const dir = MIGRATIONS_DIR;
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const [{ done }] =
      await sql`select to_regclass('pgmq.q_fastpix_jobs') is not null as done`;
    if (done) {
      skip("Job queue and cron already set up");
      return;
    }
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      await sql.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
    }
    ok(
      `Set up the job queue and cron jobs (${files.length} migration${files.length === 1 ? "" : "s"})`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Copy entries into destDir, never overwriting anything that already exists. Returns the count. */
export function copyInto(srcDir, destDir, entries) {
  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const entry of entries) {
    const dest = path.join(destDir, entry);
    if (fs.existsSync(dest)) {
      skip(`${entry} already exists, leaving it alone`);
      continue;
    }
    fs.cpSync(path.join(srcDir, entry), dest, { recursive: true });
    copied++;
  }
  return copied;
}
