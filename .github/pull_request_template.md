# Pull Request

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation update
- [ ] Refactor / internal change (no behavior change)
- [ ] Chore (build, CI, dependencies)

## Area(s) Affected

- [ ] CLI entry point / commands (`src/index.mjs`, `src/commands/`)
- [ ] `init` file generation (migrations copied, edge functions written)
- [ ] `config.toml` patching (`src/commands/toml-modifications.mjs`)
- [ ] Edge function handlers (`src/deno/` → `@fastpix/supabase/deno`)
- [ ] Webhook ingest (`src/deno/webhook.ts`)
- [ ] Queue drain / workflow dispatch (`src/deno/worker.ts`)
- [ ] Backfill / reconcile (`src/deno/backfill.ts`, `src/deno/reconcile.ts`)
- [ ] SQL migrations — pgmq queue, cron (`src/migrations/`)
- [ ] Build / packaging (`tsup.config.js`, `dist/`, `files`, `exports`)
- [ ] Docs (`README.md` / `CHANGELOG.md`)
- [ ] Other (describe):

## Summary

Describe the change and explain why it was made.

<!-- Link related issues if applicable (for example, Closes #123). -->

## Breaking Changes (if applicable)

Describe any breaking changes and any migration steps required for existing users.

<!-- Changing a handler's exported name, the `exports` map, or the generated deno.json pin all
     break projects that already ran `init`. Say what they need to do. -->

## Code Example (Optional)

If this PR changes the CLI or the generated files, include an example showing the new behavior.

```bash
npx @fastpix/supabase init
npx @fastpix/supabase migrate
npx @fastpix/supabase backfill all
npx @fastpix/supabase reconcile 24
```

```ts
// A generated edge function — supabase/functions/fastpix-webhook/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { webhook } from "@fastpix/supabase/deno";

Deno.serve(webhook);
```

## Testing

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Ran `npx @fastpix/supabase init` against a real Supabase project and the functions serve
- [ ] Re-ran `init` and it skipped every existing file (never overwrites)
- [ ] Migrations are idempotent (safe to run repeatedly; data-preserving on existing databases)
- [ ] Added / updated a test or reproduction (if applicable)

## Testing Notes (Optional)

Provide any additional testing details, screenshots, logs, or reproduction steps that help reviewers verify the change.

## Review Checklist

- [ ] The change is accurate and matches the description in this pull request.
- [ ] No secrets are logged (connection strings, tokens, stream keys, signing secrets) and no raw webhook body is logged
- [ ] Handlers stay Deno-safe — no `node:` imports added to `src/deno/`
- [ ] Nothing new at module scope in `src/deno/` (all four handlers share one bundle; module-scope work runs in every function)
- [ ] Every name `init` generates is still exported by `src/deno/index.ts`
- [ ] `verify_jwt` stays `false` for `fastpix-webhook` only
- [ ] `dist/` is not committed, and `files` / `exports` still cover everything the CLI reads at runtime
- [ ] Documentation updated (`README.md` or `CHANGELOG.md`) if the CLI, generated files, or behavior changed.
- [ ] Version bumped in `package.json` if this should be released

---
