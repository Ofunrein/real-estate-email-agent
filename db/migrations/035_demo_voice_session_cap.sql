-- Durable voice-session cap for public demo rooms.
--
-- Why: the voice route's only cap was lib/demo-rate-limit.ts, an in-process Map. On Vercel each
-- serverless instance keeps its own Map, so the "3 voice sessions per token per day" limit was
-- really "3 per instance per day" and a caller could mint more sessions by landing on new
-- instances. Vapi voice minutes cost real money per session, so this is a spend guard.
--
-- This mirrors reserve_email_generation from 034: one security-definer function, callable only by
-- demo_engagement_writer, that atomically checks the caps and records the reservation. Isolation
-- of demo content does not depend on this function -- that is enforced by token lookup -- so the
-- only thing at stake here is volume.
--
-- Idempotent: safe to re-apply.

create or replace function demo_public_api.reserve_voice_session(p_token_hash text)
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
  -- Only approved, unexpired rooms may start a voice session. An unknown or revoked token gets
  -- the same false as an over-cap room, so this function never reveals which case it hit.
  select r.id, r.client_id
    into v_room_id, v_client_id
    from public.demo_rooms r
   where r.token_hash = p_token_hash
     and r.status = 'approved'
   limit 1
   for update;
  if not found then return false; end if;

  -- The row lock above serializes sessions for one room. A transaction-level advisory lock also
  -- serializes the client-wide daily cap across different rooms, matching 034's approach.
  perform pg_catalog.pg_advisory_xact_lock(706774879, 2);

  -- Per-room daily cap. This is the limit the in-memory version intended to enforce.
  if (
    select count(*)
      from public.demo_engagement_events e
     where e.client_id = v_client_id
       and e.demo_room_id = v_room_id
       and e.event = 'voice_session_started'
       and e.created_at >= to_char(
         (now() at time zone 'utc') - interval '1 day',
         'YYYY-MM-DD HH24:MI:SS'
       )
  ) >= 3 then return false; end if;

  -- Client-wide daily ceiling, so one compromised or widely shared link cannot drain the whole
  -- voice budget for every other prospect demo belonging to the same client.
  if (
    select count(*)
      from public.demo_engagement_events e
     where e.client_id = v_client_id
       and e.event = 'voice_session_started'
       and e.created_at >= to_char(
         (now() at time zone 'utc') - interval '1 day',
         'YYYY-MM-DD HH24:MI:SS'
       )
  ) >= 40 then return false; end if;

  insert into public.demo_engagement_events
    (client_id, demo_room_id, event, created_at)
  values (v_client_id, v_room_id, 'voice_session_started', v_now);
  return true;
end
$$;

-- Same least-privilege posture as 034: revoke from the world, grant only to the writer role.
revoke all on function demo_public_api.reserve_voice_session(text) from public;
grant execute on function demo_public_api.reserve_voice_session(text)
  to demo_engagement_writer;
