-- Least-privilege database API for lumenosis-site.
--
-- The public site connects directly to Neon, removing the per-page app-to-app request,
-- but neither site role can enumerate a table. Both roles receive EXECUTE on a minimal
-- SECURITY DEFINER function and no table or sequence privileges:
--
--   demo_public_reader      lookup one room by an opaque SHA-256 token hash
--   demo_engagement_writer  append one validated event or atomically reserve one paid
--                           email generation, also by token hash
--
-- The lookup returns only the three fields already consumed by lumenosis-site's public
-- route. It never returns access_token, token_hash, prospect email, outreach recipient,
-- draft body, provider id, or another room. Passwords remain out of git; the release
-- command attaches LOGIN credentials separately.

create schema if not exists demo_public_api;
revoke all privileges on schema demo_public_api from public;

create or replace function demo_public_api.lookup_room(p_token_hash text)
returns table (id text, config_json text, expires_at text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select r.id, r.config_json, r.expires_at
    from public.demo_rooms r
   where r.token_hash = p_token_hash
     and r.status = 'approved'
   limit 1
$$;

create or replace function demo_public_api.record_engagement(
  p_token_hash text,
  p_event text,
  p_duration_seconds integer default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_room_id text;
  v_client_id text;
begin
  if p_event not in (
    'viewed',
    'email_completed',
    'voice_started',
    'voice_completed',
    'repeat_visit',
    'booking_clicked'
  ) then
    raise exception 'invalid demo engagement event' using errcode = '22023';
  end if;
  if p_duration_seconds is not null
     and (p_duration_seconds < 0 or p_duration_seconds > 180) then
    raise exception 'invalid demo engagement duration' using errcode = '22023';
  end if;

  select r.id, r.client_id
    into v_room_id, v_client_id
    from public.demo_rooms r
   where r.token_hash = p_token_hash
     and r.status = 'approved'
   limit 1;
  if not found then return false; end if;

  insert into public.demo_engagement_events
    (client_id, demo_room_id, event, duration_seconds, created_at)
  values
    (v_client_id, v_room_id, p_event, p_duration_seconds,
     to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'));
  return true;
end
$$;

create or replace function demo_public_api.reserve_email_generation(p_token_hash text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_room_id text;
  v_client_id text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS');
begin
  select r.id, r.client_id
    into v_room_id, v_client_id
    from public.demo_rooms r
   where r.token_hash = p_token_hash
     and r.status = 'approved'
   limit 1
   for update;
  if not found then return false; end if;

  -- The room lock serializes concurrent reservations for one room. A transaction-level
  -- advisory lock also serializes the corpus-wide daily cap across different rooms.
  perform pg_catalog.pg_advisory_xact_lock(706774879, 1);
  if (
    select count(*)
      from public.demo_engagement_events e
     where e.client_id = v_client_id
       and e.demo_room_id = v_room_id
       and e.event = 'email_generation_started'
       and e.created_at >= to_char(
         (now() at time zone 'utc') - interval '1 hour',
         'YYYY-MM-DD HH24:MI:SS'
       )
  ) >= 12 then return false; end if;

  if (
    select count(*)
      from public.demo_engagement_events e
     where e.client_id = v_client_id
       and e.event = 'email_generation_started'
       and e.created_at >= to_char(
         (now() at time zone 'utc') - interval '1 day',
         'YYYY-MM-DD HH24:MI:SS'
       )
  ) >= 100 then return false; end if;

  insert into public.demo_engagement_events
    (client_id, demo_room_id, event, created_at)
  values (v_client_id, v_room_id, 'email_generation_started', v_now);
  return true;
end
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'demo_public_reader') then
    create role demo_public_reader nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'demo_engagement_writer') then
    create role demo_engagement_writer nologin;
  end if;
end
$$;

-- Re-applying the migration reasserts the whole boundary, including attributes and any
-- accidental grants added later. NOINHERIT prevents either role from gaining privileges
-- through role membership.
alter role demo_public_reader
  nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role demo_engagement_writer
  nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

revoke all privileges on all tables in schema public
  from demo_public_reader, demo_engagement_writer;
revoke all privileges on all sequences in schema public
  from demo_public_reader, demo_engagement_writer;
revoke all privileges on schema public
  from demo_public_reader, demo_engagement_writer;
revoke all privileges on all functions in schema demo_public_api
  from public, demo_public_reader, demo_engagement_writer;

grant usage on schema demo_public_api
  to demo_public_reader, demo_engagement_writer;
grant execute on function demo_public_api.lookup_room(text)
  to demo_public_reader;
grant execute on function demo_public_api.record_engagement(text, text, integer)
  to demo_engagement_writer;
grant execute on function demo_public_api.reserve_email_generation(text)
  to demo_engagement_writer;

-- Read connections are additionally read-only by default. The lookup function remains
-- callable because it performs no write. Both roles have bounded statements and sessions.
alter role demo_public_reader set default_transaction_read_only = on;
alter role demo_public_reader set statement_timeout = '3s';
alter role demo_engagement_writer set statement_timeout = '3s';
alter role demo_public_reader set idle_in_transaction_session_timeout = '5s';
alter role demo_engagement_writer set idle_in_transaction_session_timeout = '5s';

-- Future objects stay private. These defaults apply to objects created by the migration
-- owner, and the explicit blanket revokes above protect every re-application.
alter default privileges in schema public
  revoke all on tables from demo_public_reader, demo_engagement_writer;
alter default privileges in schema public
  revoke all on sequences from demo_public_reader, demo_engagement_writer;
alter default privileges in schema demo_public_api
  revoke execute on functions from public, demo_public_reader, demo_engagement_writer;