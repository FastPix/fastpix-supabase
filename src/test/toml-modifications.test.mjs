// Tests for the config.toml patching in `fastpix-supabase init`.
//
// This is the only logic in the CLI that edits a file the user already owns, so it's the one that
// can do real damage: a duplicated [functions.*] section makes `supabase start` fail to parse, and
// an overwritten one silently flips verify_jwt on the webhook, which 401s every FastPix delivery.
// Everything else the CLI does is copy-if-absent, which is verified by running it.
import { missingVerifyJwtBlocks } from "../commands/toml-modifications.mjs";
import { test } from "node:test";
import assert from "node:assert";

const headers = (blocks) => blocks.map((b) => b.slice(0, b.indexOf("\n")));

test("an untouched config gets all four blocks", () => {
  const missing = missingVerifyJwtBlocks(
    'project_id = "demo"\n\n[api]\nport = 54321\n',
  );
  assert.equal(missing.length, 4);
  assert.deepEqual(headers(missing), [
    "[functions.fastpix-webhook]",
    "[functions.fastpix-worker]",
    "[functions.fastpix-reconcile]",
    "[functions.fastpix-backfill]",
  ]);
});

test("a fully configured config gets nothing, so re-running init is a no-op", () => {
  const toml = `project_id = "demo"
[functions.fastpix-webhook]
verify_jwt = false
[functions.fastpix-worker]
verify_jwt = true
[functions.fastpix-reconcile]
verify_jwt = true
[functions.fastpix-backfill]
verify_jwt = true
`;
  assert.deepEqual(missingVerifyJwtBlocks(toml), []);
});

test("a partly configured config gets only the missing blocks", () => {
  const toml =
    'project_id = "demo"\n\n[functions.fastpix-webhook]\nverify_jwt = false\n';
  const missing = missingVerifyJwtBlocks(toml);
  assert.equal(missing.length, 3);
  assert.ok(!headers(missing).includes("[functions.fastpix-webhook]"));
});

test("an existing block is left alone even when its value was changed by hand", () => {
  // Someone flipped the webhook to true themselves. We must not "fix" it back and must not add a
  // second section — both would be edits they didn't ask for.
  const toml = "[functions.fastpix-webhook]\nverify_jwt = true\n";
  assert.ok(
    !headers(missingVerifyJwtBlocks(toml)).includes(
      "[functions.fastpix-webhook]",
    ),
  );
});

test("indented and trailing-space headers still count as declared", () => {
  const toml = "  [functions.fastpix-webhook]   \n  verify_jwt = false\n";
  assert.ok(
    !headers(missingVerifyJwtBlocks(toml)).includes(
      "[functions.fastpix-webhook]",
    ),
  );
});

test("a similarly named function does not mask ours", () => {
  // `[functions.fastpix-webhook-v2]` is a different function and must not suppress our block.
  const toml = "[functions.fastpix-webhook-v2]\nverify_jwt = false\n";
  assert.equal(missingVerifyJwtBlocks(toml).length, 4);
});

test("every generated block is valid toml with the right verify_jwt value", () => {
  for (const block of missingVerifyJwtBlocks("")) {
    const [header, line] = block.trim().split("\n");
    const expected =
      header === "[functions.fastpix-webhook]" ? "false" : "true";
    assert.equal(line, `verify_jwt = ${expected}`);
  }
});
