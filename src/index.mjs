#!/usr/bin/env node
// @fastpix/supabase CLI.
//
//   npx @fastpix/supabase init                 copy files in, patch config.toml, create the tables
//   npx @fastpix/supabase migrate              create/update the fastpix tables only
//   npx @fastpix/supabase backfill [object]    import existing media / live streams
//   npx @fastpix/supabase reconcile [hours]    re-fetch + heal resources active in the last N hours
import { init } from "./commands/init.mjs";
import { backfill, migrate, reconcile } from "./commands/backfill.mjs";

// Wrapped rather than top-level await: the cjs bundle (dist/index.cjs) cannot carry one.
async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "init":
      return init();
    case "migrate":
      return migrate();
    case "backfill":
      return backfill(arg);
    case "reconcile":
      return reconcile(arg);
    default:
      console.error(
        "Usage: npx @fastpix/supabase <init|migrate|backfill [all|media|live_streams]|reconcile [hours]>",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`❌ ${e?.message ?? e}`);
  process.exit(1);
});
