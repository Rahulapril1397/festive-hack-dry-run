-- 0002_queue.sql — check-in, token allocation, queue actions, TV feed (E1, Stage 1).
-- All multi-row writes happen inside these functions so each is one transaction.
-- Errors are raised with errcode P0001 and a stable MESSAGE the API maps to HTTP:
--   QUEUE_PAUSED, QUEUE_EMPTY, INVALID_TRANSITION, ENTRY_NOT_FOUND, EVENT_NOT_FOUND,
--   FAMILY_EVENT_MISMATCH, FAMILY_EXISTS, IDEMPOTENCY_CONFLICT
-- search_path includes "extensions" because Supabase installs pgcrypto there.

-- ─── helpers ────────────────────────────────────────────────────────────────────────────────
create or replace function tv_instruction(p_token integer, p_lang app_language, p_paused boolean)
returns text language sql immutable as $$
  select case
    when p_paused and p_lang = 'hi' then 'थोड़ा विराम — कतार जल्द फिर शुरू होगी'
    when p_paused                    then 'Short break — the queue will resume shortly'
    when p_token is null and p_lang = 'hi' then 'कृपया अपने टोकन की प्रतीक्षा करें'
    when p_token is null             then 'Please wait for your token'
    when p_lang = 'hi'               then 'टोकन ' || p_token || ', कृपया मंच पर आइए'
    else 'Token ' || p_token || ', please come to the stage'
  end
$$;

-- Recompute the TV row. Pass p_announcement only when a new call should be announced.
create or replace function refresh_tv_feed(p_event uuid, p_announcement uuid default null)
returns void language plpgsql set search_path = public, extensions as $$
declare
  v_cur integer; v_next integer; v_lang app_language; v_paused boolean;
begin
  select e.language into v_lang from event e where e.id = p_event;
  select coalesce(qs.paused, false), qe.token_number into v_paused, v_cur
    from queue_state qs
    left join queue_entry qe on qe.id = qs.current_entry_id and qe.status in ('called','on_stage')
   where qs.event_id = p_event;
  select token_number into v_next from queue_entry
   where event_id = p_event and status = 'waiting' order by position limit 1;

  insert into tv_feed(event_id, token, next_token, instruction, language, announcement_id, updated_at)
  values (p_event, v_cur, v_next, tv_instruction(v_cur, v_lang, coalesce(v_paused, false)), v_lang, p_announcement, now())
  on conflict (event_id) do update set
    token = excluded.token, next_token = excluded.next_token, instruction = excluded.instruction,
    language = excluded.language,
    announcement_id = coalesce(p_announcement, tv_feed.announcement_id),
    updated_at = now()
  where (tv_feed.token, tv_feed.next_token, tv_feed.instruction, tv_feed.announcement_id)
        is distinct from (excluded.token, excluded.next_token, excluded.instruction,
                          coalesce(p_announcement, tv_feed.announcement_id));
end $$;

create or replace function set_checkin_code(p_family uuid, p_code text)
returns void language sql set search_path = public, extensions as $$
  update family set checkin_code_hash = crypt(p_code, gen_salt('bf', 6)) where id = p_family;
$$;

-- 1-based place among waiting entries, null if not waiting.
create or replace function queue_place(p_entry uuid)
returns integer language sql stable as $$
  select case when me.status = 'waiting' then
    (select count(*)::int from queue_entry o
      where o.event_id = me.event_id and o.status = 'waiting' and o.position <= me.position)
  end
  from queue_entry me where me.id = p_entry
$$;

-- ─── check-in ───────────────────────────────────────────────────────────────────────────────
-- Join the queue: allocate token if needed, insert checkin + queue_entry. Idempotent per (event, family).
create or replace function checkin_join(p_family uuid, p_event uuid, p_actor uuid, p_method text)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  v_fam family; v_event_wedding uuid; v_token integer; v_entry queue_entry;
begin
  select wedding_id into v_event_wedding from event where id = p_event;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;

  select * into v_fam from family where id = p_family for update;
  if not found or v_fam.wedding_id <> v_event_wedding then
    raise exception 'FAMILY_EVENT_MISMATCH';
  end if;

  v_token := v_fam.token_number;
  if v_token is null then
    update wedding set next_token_number = next_token_number + 1
     where id = v_fam.wedding_id
     returning next_token_number - 1 into v_token;
    update family set token_number = v_token where id = p_family;
  end if;

  insert into checkin(event_id, family_id, method, by_user)
  values (p_event, p_family, p_method, p_actor) on conflict do nothing;

  insert into queue_entry(event_id, family_id, token_number)
  values (p_event, p_family, v_token) on conflict do nothing;

  select * into v_entry from queue_entry where event_id = p_event and family_id = p_family;

  perform refresh_tv_feed(p_event);

  return jsonb_build_object(
    'familyId', p_family, 'linkKey', v_fam.link_key, 'entryId', v_entry.id,
    'token', v_token, 'status', v_entry.status, 'position', queue_place(v_entry.id));
end $$;

-- Guest self check-in. Never raises for bad input (so the failed-attempt row is kept).
-- Returns {outcome:'invalid'} | {outcome:'locked'} | {outcome:'ok', ...checkin_join}
-- ("outcome", not "status": checkin_join already has a "status" key = queue status.)
create or replace function checkin_verify(p_phone text, p_code text, p_event uuid)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  v_wedding uuid; v_fam family; v_fails integer;
begin
  select wedding_id into v_wedding from event where id = p_event;
  if not found then return jsonb_build_object('outcome','invalid'); end if;

  select * into v_fam from family where wedding_id = v_wedding and phone = p_phone for update;
  if not found then return jsonb_build_object('outcome','invalid'); end if;

  select count(*) into v_fails from checkin_attempt
   where family_id = v_fam.id and not success and created_at > now() - interval '15 minutes';
  if v_fails >= 5 then return jsonb_build_object('outcome','locked'); end if;

  if v_fam.checkin_code_hash is null
     or v_fam.checkin_code_hash <> crypt(p_code, v_fam.checkin_code_hash) then
    insert into checkin_attempt(family_id, event_id, success) values (v_fam.id, p_event, false);
    return jsonb_build_object('outcome', case when v_fails + 1 >= 5 then 'locked' else 'invalid' end);
  end if;

  insert into checkin_attempt(family_id, event_id, success) values (v_fam.id, p_event, true);
  return checkin_join(v_fam.id, p_event, null, 'self') || jsonb_build_object('outcome','ok');
end $$;

create or replace function checkin_walk_in(p_event uuid, p_actor uuid, p_name text, p_phone text, p_language app_language)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare v_wedding uuid; v_family uuid;
begin
  select wedding_id into v_wedding from event where id = p_event;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if p_phone is not null and exists (select 1 from family where wedding_id = v_wedding and phone = p_phone) then
    raise exception 'FAMILY_EXISTS';
  end if;
  insert into family(wedding_id, name, phone, language, is_walk_in)
  values (v_wedding, p_name, p_phone, coalesce(p_language, 'en'), true)
  returning id into v_family;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (v_wedding, p_actor, 'checkin.walk_in', v_family::text, jsonb_build_object('event_id', p_event));
  return checkin_join(v_family, p_event, p_actor, 'walk_in');
end $$;

-- Desk lookup by phone digits, name fragment or token number.
create or replace function checkin_lookup(p_event uuid, p_q text)
returns table(family_id uuid, name text, phone_last4 text, token integer, is_walk_in boolean,
              checked_in boolean, queue_status queue_status)
language sql stable set search_path = public, extensions as $$
  select f.id, f.name, right(f.phone, 4), f.token_number, f.is_walk_in,
         c.id is not null, qe.status
    from event e
    join family f on f.wedding_id = e.wedding_id
    left join checkin c on c.event_id = e.id and c.family_id = f.id
    left join queue_entry qe on qe.event_id = e.id and qe.family_id = f.id
   where e.id = p_event
     and ( (length(trim(p_q)) >= 2 and f.name ilike '%' || trim(p_q) || '%')
        or (length(regexp_replace(p_q, '\D', '', 'g')) >= 3 and f.phone like '%' || regexp_replace(p_q, '\D', '', 'g') || '%')
        or (trim(p_q) ~ '^\d{1,6}$' and f.token_number = trim(p_q)::int))
   order by f.name
   limit 20
$$;

-- ─── queue actions ──────────────────────────────────────────────────────────────────────────
-- Lock queue_state for an event (creating it on first use). Serialises all queue writes per event.
create or replace function lock_queue_state(p_event uuid)
returns queue_state language plpgsql set search_path = public, extensions as $$
declare v queue_state;
begin
  if not exists (select 1 from event where id = p_event) then raise exception 'EVENT_NOT_FOUND'; end if;
  insert into queue_state(event_id) values (p_event) on conflict do nothing;
  select * into v from queue_state where event_id = p_event for update;
  return v;
end $$;

create or replace function call_next(p_event uuid, p_actor uuid, p_idem text)
returns stage_log language plpgsql set search_path = public, extensions as $$
declare v_log stage_log; v_state queue_state; v_entry queue_entry;
begin
  -- fast replay path
  select * into v_log from stage_log where event_id = p_event and idempotency_key = p_idem;
  if found then
    if v_log.action <> 'called' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_log;
  end if;

  v_state := lock_queue_state(p_event);

  -- re-check under the lock: a concurrent request with the same key may have just committed
  select * into v_log from stage_log where event_id = p_event and idempotency_key = p_idem;
  if found then
    if v_log.action <> 'called' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_log;
  end if;

  if v_state.paused then raise exception 'QUEUE_PAUSED'; end if;

  select * into v_entry from queue_entry
   where event_id = p_event and status = 'waiting'
   order by position limit 1
   for update skip locked;
  if not found then raise exception 'QUEUE_EMPTY'; end if;

  update queue_entry set status = 'called', called_at = now(), updated_at = now() where id = v_entry.id;
  update queue_state set current_entry_id = v_entry.id, updated_at = now() where event_id = p_event;

  insert into stage_log(event_id, queue_entry_id, token_number, action, actor, idempotency_key)
  values (p_event, v_entry.id, v_entry.token_number, 'called', p_actor, p_idem)
  returning * into v_log;

  perform refresh_tv_feed(p_event, v_log.id);
  return v_log;
end $$;

-- skip | on_stage | served | no_show (need p_entry) and paused | resumed (no entry).
-- Transition table mirrors src/domain/queue/stateMachine.ts.
create or replace function queue_action(p_event uuid, p_actor uuid, p_idem text, p_action stage_action, p_entry uuid default null)
returns stage_log language plpgsql set search_path = public, extensions as $$
declare
  v_log stage_log; v_state queue_state; v_entry queue_entry; v_new queue_status; v_skips integer;
begin
  if p_action = 'called' then raise exception 'INVALID_TRANSITION'; end if;  -- use call_next

  select * into v_log from stage_log where event_id = p_event and idempotency_key = p_idem;
  if found then
    if v_log.action <> p_action then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_log;
  end if;

  v_state := lock_queue_state(p_event);

  select * into v_log from stage_log where event_id = p_event and idempotency_key = p_idem;
  if found then
    if v_log.action <> p_action then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_log;
  end if;

  if p_action in ('paused','resumed') then
    if v_state.paused = (p_action = 'paused') then raise exception 'INVALID_TRANSITION'; end if;
    update queue_state set paused = (p_action = 'paused'), updated_at = now() where event_id = p_event;
    insert into stage_log(event_id, action, actor, idempotency_key)
    values (p_event, p_action, p_actor, p_idem) returning * into v_log;
    perform refresh_tv_feed(p_event);
    return v_log;
  end if;

  select * into v_entry from queue_entry where id = p_entry and event_id = p_event for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;

  v_skips := v_entry.skip_count;
  if p_action = 'skipped' and v_entry.status in ('waiting','called') then
    v_skips := v_skips + 1;
    v_new := case when v_skips >= 2 then 'no_show' else 'waiting' end;
  elsif p_action = 'on_stage' and v_entry.status = 'called' then v_new := 'on_stage';
  elsif p_action = 'served'   and v_entry.status in ('called','on_stage') then v_new := 'served';
  elsif p_action = 'no_show'  and v_entry.status in ('waiting','called') then v_new := 'no_show';
  else
    raise exception 'INVALID_TRANSITION';
  end if;

  update queue_entry set
    status = v_new,
    skip_count = v_skips,
    position = case when p_action = 'skipped' and v_new = 'waiting' then nextval('queue_position_seq') else position end,
    updated_at = now()
   where id = v_entry.id;

  if v_state.current_entry_id = v_entry.id and v_new in ('waiting','no_show') then
    update queue_state set current_entry_id = null, updated_at = now() where event_id = p_event;
  end if;

  insert into stage_log(event_id, queue_entry_id, token_number, action, actor, idempotency_key)
  values (p_event, v_entry.id, v_entry.token_number, p_action, p_actor, p_idem) returning * into v_log;

  -- second skip: also record the automatic no_show (derived key keeps replay deterministic)
  if p_action = 'skipped' and v_new = 'no_show' then
    insert into stage_log(event_id, queue_entry_id, token_number, action, actor, idempotency_key)
    values (p_event, v_entry.id, v_entry.token_number, 'no_show', p_actor, p_idem || ':auto_no_show');
  end if;

  perform refresh_tv_feed(p_event);
  return v_log;
end $$;

-- ─── reads ──────────────────────────────────────────────────────────────────────────────────
-- Contract C2 (see src/contracts/queue.ts).
create or replace function get_queue_status(p_family uuid, p_event uuid)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object(
    'eventId', p_event,
    'familyId', p_family,
    'checkedIn', exists (select 1 from checkin c where c.event_id = p_event and c.family_id = p_family),
    'token', (select token_number from family where id = p_family),
    'status', qe.status,
    'position', queue_place(qe.id),
    'nowServing', tf.token,
    'paused', coalesce(qs.paused, false),
    'updatedAt', greatest(qe.updated_at, tf.updated_at))
  from (select 1) one
  left join queue_entry qe on qe.event_id = p_event and qe.family_id = p_family
  left join tv_feed tf on tf.event_id = p_event
  left join queue_state qs on qs.event_id = p_event
$$;

-- Stage console snapshot (staff only: includes family names).
create or replace function queue_snapshot(p_event uuid)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object(
    'eventId', p_event,
    'paused', coalesce((select paused from queue_state where event_id = p_event), false),
    'currentEntryId', (select current_entry_id from queue_state where event_id = p_event),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entryId', qe.id, 'token', qe.token_number, 'familyName', f.name,
               'isWalkIn', f.is_walk_in, 'status', qe.status, 'skipCount', qe.skip_count,
               'calledAt', qe.called_at)
             order by case qe.status when 'on_stage' then 0 when 'called' then 1 else 2 end, qe.position)
        from queue_entry qe join family f on f.id = qe.family_id
       where qe.event_id = p_event and qe.status in ('waiting','called','on_stage')), '[]'::jsonb),
    'counts', (select jsonb_object_agg(status, n) from
                 (select status, count(*) n from queue_entry where event_id = p_event group by status) s),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'token', l.token_number, 'at', l.created_at)
                       order by l.created_at desc)
        from (select * from stage_log where event_id = p_event order by created_at desc limit 15) l), '[]'::jsonb))
$$;

create or replace function session_role(p_user uuid)
returns table(role_key text, wedding_id uuid) language sql stable set search_path = public, extensions as $$
  select r.key, ur.wedding_id from user_role ur join role r on r.id = ur.role_id
   where ur.user_id = p_user order by r.key limit 1
$$;

-- Only the service role may call these through PostgREST.
do $$
begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema public to service_role';
  end if;
end $$;
