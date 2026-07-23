-- 0002_fastpix_expose_pgmq_functions.sql — RPC-callable wrappers over pgmq.
--
-- PostgREST can only reach functions in an exposed schema, and `pgmq` is not one. These wrappers
-- make the queue callable over the REST API via supabase-js .rpc().
--
-- The four Edge Functions in this package do NOT use these — they call pgmq.* directly over a
-- Postgres connection. They exist so a client or another service can work the queue without a
-- direct database connection. If you never need that, this migration can be dropped.

create or replace function pgmq_public.send(queue_name text, message jsonb)
returns bigint
language sql
security definer
as $$
select pgmq.send(queue_name => queue_name, msg => message);
$$;

create or replace function pgmq_public.read(queue_name text, sleep_seconds integer default 30, n integer default 1)
returns setof pgmq.message_record
language sql
security definer
as $$
select * from pgmq.read(queue_name => queue_name, vt => sleep_seconds, qty => n);
$$;

create or replace function pgmq_public.pop(queue_name text)
returns setof pgmq.message_record
language sql
security definer
as $$
select * from pgmq.pop(queue_name => queue_name);
$$;

create or replace function pgmq_public.delete(queue_name text, msg_id bigint)
returns boolean
language sql
security definer
as $$
select pgmq.delete(queue_name => queue_name, msg_id => msg_id);
$$;

create or replace function pgmq_public.archive(queue_name text, msg_id bigint)
returns boolean
language sql
security definer
as $$
select pgmq.archive(queue_name => queue_name, msg_id => msg_id);
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default, which would undo the restrictive
-- grant in 0001. Revoke it and hand execute to service_role only.
revoke execute on all functions in schema pgmq_public from public;
grant execute on all functions in schema pgmq_public to service_role;
