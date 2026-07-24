# Changelog

All notable changes to `@fastpix/supabase` are documented in this file.

## [0.1.0] - beta version

Initial beta release.

### Added

- CLI: `fastpix-supabase init | migrate | backfill`. `init` copies the migrations and edge functions into your project, sets `verify_jwt` in `config.toml`, prompts for credentials, and creates the tables. Re-running is safe.
- Supabase Edge Functions: `fastpix-webhook` (ingest + verify + enqueue), `fastpix-worker` (queue drain + process), `fastpix-backfill` (one-off import), and `fastpix-reconcile` (nightly heal).
- SQL migrations for the pgmq queue and Supabase Cron (per-minute worker drain, nightly reconcile). The `fastpix` schema and tables are created by the engine via `npm run migrate` / `fastpix-supabase migrate`.
- Row Level Security, with secret-bearing columns locked to the service role.
- Workflow dispatch: map an event type to your own edge functions with `FASTPIX_WORKFLOWS`. The worker POSTs to each mapped function after the event syncs, with at-least-once delivery and an archive-after-N retry cap.
- Tests for the `config.toml` patching, plus lint (eslint) and format (prettier) checks and CI workflows.
