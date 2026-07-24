// `init` generates `import { <handler> } from "@fastpix/supabase/deno"` for each function, where
// the handler name is derived from the function name. Nothing at build time connects those two, so
// renaming a handler in src/deno would silently ship four edge functions that fail to import.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FUNCTIONS, handlerFor } from "../commands/utils.mjs";

const barrel = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "deno",
    "index.ts",
  ),
  "utf8",
);

test("every function's handler is exported by the deno bundle", () => {
  for (const fn of FUNCTIONS) {
    assert.match(
      barrel,
      new RegExp(`export \\{ ${handlerFor(fn)} \\}`),
      `src/deno/index.ts does not export "${handlerFor(fn)}" for ${fn}`,
    );
  }
});
