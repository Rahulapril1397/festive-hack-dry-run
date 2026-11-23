-- 0202_ledger.sql — E3: Shagun ledger. Entries are immutable: corrections are a reversing entry
-- (+ a new one); reconciliation is its own append-only table (latest row wins).

drop table if exists ledger_entry;
create type payment_method as enum ('cash','upi','boxed_gift');

create table ledger_entry (
  id               uuid primary key default gen_random_uuid(),
  wedding_id       uuid not null references wedding(id) on delete cascade,
  family_id        uuid references family(id),
  event_id         uuid references event(id),
  token_reference  text,                                  -- envelope / token written on it
  gift_type        text not null default 'shagun',
  payment_method   payment_method not null,
  amount           numeric(12,2),                         -- null only for boxed gifts; negative only on reversals
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  reverses_id      uuid unique references ledger_entry(id),
  check (payment_method = 'boxed_gift' or amount is not null),
  check (reverses_id is not null or amount is null or amount > 0)
);
create index ledger_entry_wedding_idx on ledger_entry(wedding_id, created_at desc);

create trigger ledger_entry_append_only before update or delete on ledger_entry
  for each row execute function append_only();

create table ledger_reconciliation (
  id             bigint generated always as identity primary key,
  entry_id       uuid not null references ledger_entry(id),
  family_id      uuid not null references family(id),
  reconciled_by  uuid,
  created_at     timestamptz not null default now()
);
create trigger ledger_reconciliation_append_only before update or delete on ledger_reconciliation
  for each row execute function append_only();

-- One row per entry with derived state. Amount columns are here; the API strips them without ledger.read.
create or replace view v_ledger_entry with (security_invoker = true) as
select le.*,
       coalesce(rec.family_id, le.family_id)                                     as effective_family_id,
       rec.created_at                                                            as reconciled_at,
       (le.reverses_id is not null)                                              as is_reversal,
       exists (select 1 from ledger_entry r where r.reverses_id = le.id)         as is_reversed
  from ledger_entry le
  left join lateral (select lr.family_id, lr.created_at from ledger_reconciliation lr
                      where lr.entry_id = le.id order by lr.id desc limit 1) rec on true;

create or replace function ledger_add(p_wedding uuid, p_actor uuid, p_family uuid, p_event uuid, p_token_ref text,
                                      p_gift_type text, p_method payment_method, p_amount numeric, p_notes text)
returns ledger_entry language plpgsql set search_path = public, extensions as $$
declare v ledger_entry;
begin
  if p_family is not null and not exists (select 1 from family where id = p_family and wedding_id = p_wedding) then
    raise exception 'NOT_FOUND';
  end if;
  if p_event is not null and not exists (select 1 from event where id = p_event and wedding_id = p_wedding) then
    raise exception 'EVENT_NOT_FOUND';
  end if;
  if p_method <> 'boxed_gift' and (p_amount is null or p_amount <= 0) then raise exception 'BAD_REQUEST'; end if;
  insert into ledger_entry(wedding_id, family_id, event_id, token_reference, gift_type, payment_method, amount, notes, created_by)
  values (p_wedding, p_family, p_event, nullif(trim(p_token_ref), ''), coalesce(nullif(trim(p_gift_type), ''), 'shagun'),
          p_method, case when p_method = 'boxed_gift' then p_amount else p_amount end, p_notes, p_actor)
  returning * into v;
  insert into audit_log(wedding_id, actor, action, target, data)  -- no amounts in the audit log
  values (p_wedding, p_actor, 'ledger.add', v.id::text, jsonb_build_object('method', p_method));
  return v;
end $$;

create or replace function ledger_reverse(p_wedding uuid, p_actor uuid, p_entry uuid, p_notes text)
returns ledger_entry language plpgsql set search_path = public, extensions as $$
declare o ledger_entry; v ledger_entry;
begin
  select * into o from ledger_entry where id = p_entry and wedding_id = p_wedding for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.reverses_id is not null or exists (select 1 from ledger_entry where reverses_id = o.id) then
    raise exception 'INVALID_TRANSITION';
  end if;
  insert into ledger_entry(wedding_id, family_id, event_id, token_reference, gift_type, payment_method, amount, notes, created_by, reverses_id)
  values (o.wedding_id, o.family_id, o.event_id, o.token_reference, o.gift_type, o.payment_method, -o.amount,
          coalesce(p_notes, 'Reversal'), p_actor, o.id)
  returning * into v;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (p_wedding, p_actor, 'ledger.reverse', o.id::text, jsonb_build_object('reversal_id', v.id));
  return v;
end $$;

create or replace function ledger_reconcile(p_wedding uuid, p_actor uuid, p_entry uuid, p_family uuid)
returns ledger_reconciliation language plpgsql set search_path = public, extensions as $$
declare v ledger_reconciliation;
begin
  if not exists (select 1 from ledger_entry where id = p_entry and wedding_id = p_wedding and reverses_id is null) then
    raise exception 'NOT_FOUND';
  end if;
  if not exists (select 1 from family where id = p_family and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  insert into ledger_reconciliation(entry_id, family_id, reconciled_by) values (p_entry, p_family, p_actor) returning * into v;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (p_wedding, p_actor, 'ledger.reconcile', p_entry::text, jsonb_build_object('family_id', p_family));
  return v;
end $$;

select lock_down_public();
