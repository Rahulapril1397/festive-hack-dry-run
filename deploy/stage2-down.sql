-- stage2-down.sql — reverses migrations 0204, 0110, 0011, 0010 so a Stage 1 image works again.
-- Keeps all wedding data (families, RSVPs, check-ins, queue, ledger, photos, audit log).
-- Removed: Stage 2-only tables (PinkyBua history, flag/TTS logs), assignment windows, suspension
-- flags, super_admin / coordinator / custom roles and their assignments, role_permission rows.
-- Run by deploy/rollback-stage2.sh in one transaction; tested against a Stage 1 schema snapshot.
begin;

-- 0204_live
drop index if exists photo_batch_hash_uidx;
drop index if exists photo_review_idx;
alter table photo drop column if exists content_hash;
alter table meal_status drop constraint if exists meal_status_updated_by_fkey;

-- 0110_assistant
drop function if exists assistant_claim_action(uuid, text, uuid, uuid);
drop function if exists assistant_finish_action(uuid, boolean, text, uuid, uuid);
drop table if exists assistant_action, assistant_message, assistant_session, feature_flag_eval_log, tts_event;

-- 0011_admin
drop function if exists admin_upsert_user(uuid, uuid, uuid, text, text);
drop function if exists admin_set_user_status(uuid, uuid, uuid, text);
drop function if exists admin_assign(uuid, uuid, uuid, uuid, timestamptz, timestamptz);
drop function if exists admin_unassign(uuid, uuid);
drop function if exists admin_create_role(uuid, text, text, text, text[]);
drop function if exists admin_set_role_permissions(uuid, uuid, text[]);
drop function if exists admin_create_wedding(uuid, jsonb, jsonb, uuid);
drop function if exists families_import(uuid, uuid, jsonb);
drop function if exists family_rotate_link(uuid, uuid, uuid);
drop function if exists rsvp_save_by_staff(uuid, uuid, uuid, jsonb);
drop function if exists audit(uuid, uuid, text, text, jsonb);
drop index if exists audit_log_wedding_id_idx;
drop index if exists audit_log_actor_idx;
drop index if exists audit_log_action_idx;
alter table family drop column if exists headcount_max;

-- 0010_rbac
drop function if exists authz_context(uuid, uuid);
drop function if exists authz_permissions(uuid, uuid);
drop schema if exists authz cascade;            -- resolver, guards and their triggers

-- assignments back to the Stage 1 shape: one row per (user, role, wedding), no windows
delete from user_role where wedding_id is null; -- super_admin
delete from user_role where expires_at is not null and expires_at <= now();
drop index if exists user_role_unique;
drop index if exists user_role_user_idx;
alter table user_role drop constraint if exists user_role_window;
alter table user_role drop constraint if exists user_role_pkey;
alter table user_role drop column if exists id, drop column if exists starts_at, drop column if exists expires_at,
                      drop column if exists created_by, drop column if exists created_at;
alter table user_role alter column wedding_id set not null;
alter table user_role add primary key (user_id, role_id, wedding_id);

-- roles: Stage 1 knew exactly these six (permissions lived in code)
update role set key = 'stage', name = 'Stage manager' where key = 'stage_manager';
delete from role_permission;
delete from user_role where role_id in (select id from role where key not in ('host','stage','kitchen','photographer','admin','finance'));
delete from role where key not in ('host','stage','kitchen','photographer','admin','finance');
alter table role drop column if exists is_system, drop column if exists description, drop column if exists created_at;
delete from permission;

alter table app_user drop column if exists status, drop column if exists language, drop column if exists invited_at,
                     drop column if exists suspended_at, drop column if exists last_seen_at;

-- Stage 1 sign-in helper (0002_queue.sql)
create or replace function session_role(p_user uuid)
returns table(role_key text, wedding_id uuid) language sql stable set search_path = public, extensions as $$
  select r.key, ur.wedding_id from user_role ur join role r on r.id = ur.role_id
   where ur.user_id = p_user order by r.key limit 1
$$;

select lock_down_public();

delete from pehle_meta.migration where name in ('0010_rbac.sql', '0011_admin.sql', '0110_assistant.sql', '0204_live.sql');

commit;
