// config.toml edits.
//
// Deliberately no TOML parser: parsing and re-emitting would reformat the whole file the user owns.
// Appending only ever adds the sections that are missing, and leaves formatting and comments alone.
import { ok, skip, FUNCTIONS } from "./utils.mjs";
import path from "node:path";
import fs from "node:fs";

// The ingest endpoint is called by FastPix with a signature header rather than a Supabase JWT, so
// verify_jwt MUST be false for it. The other three are called by pg_cron or by an operator using
// the service-role key, so they keep it on.
export const VERIFY_JWT = FUNCTIONS.map(
  (fn) =>
    `[functions.${fn}]\nverify_jwt = ${fn === "fastpix-webhook" ? "false" : "true"}\n`,
);

const BANNER =
  "\n# --- FastPix functions ---------------------------------------------------------------------\n" +
  "# fastpix-webhook is called by FastPix, which signs requests instead of sending a Supabase JWT,\n" +
  "# so it must skip JWT verification. The others are called with the service-role key.\n";

/**
 * Which verify_jwt blocks a config.toml is still missing.
 *
 * Pure, so it carries the tests. This is the only logic in the CLI that edits a file the user
 * already owns: a duplicated [functions.*] section stops `supabase start` from parsing it, and an
 * overwritten one silently flips verify_jwt on the webhook, which 401s every FastPix delivery.
 */
export function missingVerifyJwtBlocks(currentToml) {
  const declared = new Set(currentToml.split("\n").map((line) => line.trim()));
  return VERIFY_JWT.filter(
    (block) => !declared.has(block.slice(0, block.indexOf("\n"))),
  );
}

export function patchConfigToml(dir) {
  const file = path.join(dir, "config.toml");
  if (!fs.existsSync(file)) {
    skip("config.toml not found, skipping verify_jwt setup");
    return;
  }
  const missing = missingVerifyJwtBlocks(fs.readFileSync(file, "utf-8"));
  if (missing.length === 0) {
    skip("config.toml already has verify_jwt for all four functions");
    return;
  }
  fs.appendFileSync(file, `${BANNER}\n${missing.join("\n")}`);
  ok(`Added verify_jwt for ${missing.length} function(s) to config.toml`);
}
