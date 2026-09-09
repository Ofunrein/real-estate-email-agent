-- Raise each public demo link to 10 voice sessions per rolling 24 hours and return remaining uses.
-- Admin previews bypass this function in the site route and remain unlimited.

create or replace function demo_public_api.reserve_voice_session_v2(p_token_hash text)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_room_id text;
  v_client_id text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS');
  v_used integer;
begin
  select r.id, r.client_id
    into v_room_id, v_client_id
    from public.demo_rooms r
   where r.token_hash = p_token_hash
     and r.status = 'approved'
   limit 1
   for update;
  if not found then return -1; end if;

  perform pg_catalog.pg_advisory_xact_lock(706774879, 2);

  select count(*)::integer
    into v_used
    from public.demo_engagement_events e
   where e.client_id = v_client_id
     and e.demo_room_id = v_room_id
     and e.event = 'voice_session_started'
     and e.created_at >= to_char(
       (now() at time zone 'utc') - interval '1 day',
       'YYYY-MM-DD HH24:MI:SS'
     );
  if v_used >= 10 then return -1; end if;

  -- Keep the existing client-wide abuse ceiling while allowing several links to be tested.
  if (
    select count(*)
      from public.demo_engagement_events e
     where e.client_id = v_client_id
       and e.event = 'voice_session_started'
       and e.created_at >= to_char(
         (now() at time zone 'utc') - interval '1 day',
         'YYYY-MM-DD HH24:MI:SS'
       )
  ) >= 100 then return -1; end if;

  insert into public.demo_engagement_events
    (client_id, demo_room_id, event, created_at)
  values (v_client_id, v_room_id, 'voice_session_started', v_now);
  return 9 - v_used;
end
$$;

revoke all on function demo_public_api.reserve_voice_session_v2(text) from public;
grant execute on function demo_public_api.reserve_voice_session_v2(text)
  to demo_engagement_writer;
