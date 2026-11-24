-- 0210_vendors.sql — Stage 3 (E3): vendor directory, contacts, function assignments, commercial
-- records (restricted), notes (optionally restricted) and documents (private bucket "vendor-docs").
-- Permissions split who sees what: contacts / manage / commercial read / commercial write / documents.

create extension if not exists pg_trgm;   -- fuzzy name search + duplicate warning (Supabase: schema "extensions")

create table vendor_category (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references wedding(id) on delete cascade,
  key         text not null,
  name        text not null,
  sort        integer not null default 0,
  unique (wedding_id, key)
);

create or replace function vendor_seed_categories(p_wedding uuid) returns void language sql set search_path = public as $$
  insert into vendor_category(wedding_id, key, name, sort)
  select p_wedding, k, n, s from (values
    ('caterer','Caterer',1), ('decorator','Decorator',2), ('photographer','Photographer',3), ('videographer','Videographer',4),
    ('mehendi','Mehendi artist',5), ('makeup','Makeup and hair',6), ('dj_music','DJ / Music',7), ('dhol_band','Dhol / Band',8),
    ('pandit','Pandit ji',9), ('tent_lights','Tent and lights',10), ('venue','Venue',11), ('transport','Transport',12),
    ('florist','Florist',13), ('other','Other',99)) d(k, n, s)
  on conflict (wedding_id, key) do nothing;
$$;
create or replace function vendor_categories_for_new_wedding() returns trigger language plpgsql set search_path = public as $$
begin
  perform vendor_seed_categories(new.id);
  return new;
end $$;
create trigger wedding_vendor_categories after insert on wedding for each row execute function vendor_categories_for_new_wedding();
select vendor_seed_categories(id) from wedding;

create table vendor (
  id             uuid primary key default gen_random_uuid(),
  wedding_id     uuid not null references wedding(id) on delete cascade,
  category_id    uuid not null references vendor_category(id),
  name           text not null check (length(trim(name)) between 2 and 120),
  business_name  text,
  city           text,
  website        text check (website is null or website ~ '^https?://'),
  services       text,                                -- what they provide (public to vendor viewers)
  status         text not null default 'active' check (status in ('active','inactive')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index vendor_wedding_idx on vendor(wedding_id, status);
create index vendor_name_trgm on vendor using gin (lower(name) gin_trgm_ops);

create table vendor_contact (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references vendor(id) on delete cascade,
  name        text not null,
  role        text,
  phone       text,
  email       text,
  whatsapp    boolean not null default true,
  is_primary  boolean not null default false,
  sort        integer not null default 0
);
create index vendor_contact_vendor_idx on vendor_contact(vendor_id);
create index vendor_contact_phone_idx on vendor_contact(phone);

create table vendor_event_assignment (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references vendor(id) on delete cascade,
  event_id    uuid not null references event(id) on delete cascade,
  scope       text,                                   -- "Dinner for 300", "Stage + entrance"
  arrival_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (vendor_id, event_id)
);
create index vendor_assignment_event_idx on vendor_event_assignment(event_id);

-- Commercial terms (vendors.commercial.read / .write only). Amounts in paise.
create table vendor_commercial (
  vendor_id              uuid primary key references vendor(id) on delete cascade,
  quoted_amount_paise    bigint check (quoted_amount_paise >= 0),
  contract_amount_paise  bigint check (contract_amount_paise >= 0),
  payment_terms          text,
  contract_status        text not null default 'none' check (contract_status in ('none','quoted','negotiating','signed','completed','cancelled')),
  updated_by             uuid,
  updated_at             timestamptz not null default now()
);

create table vendor_payment (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references vendor(id) on delete cascade,
  kind           text not null check (kind in ('advance','payment','refund')),
  amount_paise   bigint not null check (amount_paise > 0),
  due_at         date,
  paid_at        date,
  method         text check (method in ('cash','upi','bank','cheque','card','other')),
  reference      text,
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index vendor_payment_vendor_idx on vendor_payment(vendor_id);

create table vendor_note (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references vendor(id) on delete cascade,
  body        text not null check (length(trim(body)) between 1 and 4000),
  restricted  boolean not null default false,          -- true: commercial readers only
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index vendor_note_vendor_idx on vendor_note(vendor_id, created_at desc);

create table vendor_document (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references vendor(id) on delete cascade,
  kind          text not null check (kind in ('contract','quote','invoice','receipt','id','other')),
  file_name     text not null,
  storage_path  text not null unique,
  content_type  text not null,
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by   uuid,
  created_at    timestamptz not null default now()
);
create index vendor_document_vendor_idx on vendor_document(vendor_id);

-- ─── functions ─────────────────────────────────────────────────────────────────────────────
-- Possible duplicates in the wedding: similar name or same contact phone (UI shows a warning).
create or replace function vendor_duplicates(p_wedding uuid, p_name text, p_phone text, p_exclude uuid)
returns table(id uuid, name text, reason text) language sql stable set search_path = public, extensions as $$
  select v.id, v.name, 'similar name' from vendor v
   where v.wedding_id = p_wedding and v.id is distinct from p_exclude and coalesce(p_name, '') <> ''
     and similarity(lower(v.name), lower(p_name)) > 0.45
  union
  select v.id, v.name, 'same phone' from vendor v join vendor_contact c on c.vendor_id = v.id
   where v.wedding_id = p_wedding and v.id is distinct from p_exclude and coalesce(p_phone, '') <> ''
     and regexp_replace(c.phone, '\D', '', 'g') like '%' || right(regexp_replace(p_phone, '\D', '', 'g'), 10)
$$;

-- p = {categoryId, name, businessName?, city?, website?, services?, contacts?: [{name, role?, phone?, email?, whatsapp?, isPrimary?}], force?}
create or replace function vendor_upsert(p_actor uuid, p_wedding uuid, p_id uuid, p jsonb)
returns vendor language plpgsql set search_path = public, extensions as $$
declare v vendor; v_cat uuid := nullif(p->>'categoryId', '')::uuid;
begin
  if v_cat is not null and not exists (select 1 from vendor_category where id = v_cat and wedding_id = p_wedding) then raise exception 'BAD_REQUEST'; end if;
  if p_id is null then
    if not coalesce((p->>'force')::boolean, false) and exists (
         select 1 from vendor where wedding_id = p_wedding and lower(trim(name)) = lower(trim(p->>'name'))) then
      raise exception 'VENDOR_DUPLICATE';
    end if;
    insert into vendor(wedding_id, category_id, name, business_name, city, website, services, created_by)
    values (p_wedding, v_cat, trim(p->>'name'), nullif(p->>'businessName', ''), nullif(p->>'city', ''), nullif(p->>'website', ''), nullif(p->>'services', ''), p_actor)
    returning * into v;
    perform audit(p_wedding, p_actor, 'vendor.create', v.id::text, jsonb_build_object('name', v.name));
  else
    update vendor set
      category_id = coalesce(v_cat, category_id),
      name = coalesce(nullif(trim(p->>'name'), ''), name),
      business_name = case when p ? 'businessName' then nullif(p->>'businessName', '') else business_name end,
      city = case when p ? 'city' then nullif(p->>'city', '') else city end,
      website = case when p ? 'website' then nullif(p->>'website', '') else website end,
      services = case when p ? 'services' then nullif(p->>'services', '') else services end,
      updated_at = now()
     where id = p_id and wedding_id = p_wedding returning * into v;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform audit(p_wedding, p_actor, 'vendor.update', v.id::text, (p - 'contacts' - 'force') || jsonb_build_object('contacts_changed', p ? 'contacts'));
  end if;
  if p ? 'contacts' then
    delete from vendor_contact where vendor_id = v.id;
    insert into vendor_contact(vendor_id, name, role, phone, email, whatsapp, is_primary, sort)
    select v.id, trim(c->>'name'), nullif(c->>'role', ''), nullif(c->>'phone', ''), nullif(lower(c->>'email'), ''),
           coalesce((c->>'whatsapp')::boolean, true), coalesce((c->>'isPrimary')::boolean, false), ord::int
      from jsonb_array_elements(p->'contacts') with ordinality as t(c, ord)
     where length(trim(coalesce(c->>'name', ''))) > 0;
  end if;
  return v;
end $$;

create or replace function vendor_set_status(p_actor uuid, p_wedding uuid, p_vendor uuid, p_status text)
returns vendor language plpgsql set search_path = public as $$
declare v vendor;
begin
  update vendor set status = p_status, updated_at = now() where id = p_vendor and wedding_id = p_wedding and status <> p_status returning * into v;
  if not found then raise exception 'INVALID_TRANSITION'; end if;
  perform audit(p_wedding, p_actor, case when p_status = 'inactive' then 'vendor.deactivate' else 'vendor.reactivate' end, v.id::text);
  return v;
end $$;

-- Book a vendor for a function (or update scope/arrival); p_remove = true unassigns.
create or replace function vendor_assign_event(p_actor uuid, p_wedding uuid, p_vendor uuid, p_event uuid, p_scope text, p_arrival timestamptz, p_remove boolean)
returns void language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from vendor where id = p_vendor and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from event where id = p_event and wedding_id = p_wedding) then raise exception 'EVENT_NOT_FOUND'; end if;
  if p_remove then
    delete from vendor_event_assignment where vendor_id = p_vendor and event_id = p_event;
  else
    insert into vendor_event_assignment(vendor_id, event_id, scope, arrival_at) values (p_vendor, p_event, nullif(p_scope, ''), p_arrival)
    on conflict (vendor_id, event_id) do update set scope = excluded.scope, arrival_at = excluded.arrival_at;
  end if;
  perform audit(p_wedding, p_actor, case when p_remove then 'vendor.unassign' else 'vendor.assign' end, p_vendor::text, jsonb_build_object('event_id', p_event));
end $$;

-- Commercial terms with an audit diff. Amount fields are recorded as changed, never their values
-- (audit.read does not imply vendors.commercial.read).
create or replace function vendor_set_commercial(p_actor uuid, p_wedding uuid, p_vendor uuid, p jsonb)
returns vendor_commercial language plpgsql set search_path = public as $$
declare o vendor_commercial; v vendor_commercial; d jsonb := '{}';
begin
  if not exists (select 1 from vendor where id = p_vendor and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  insert into vendor_commercial(vendor_id) values (p_vendor) on conflict do nothing;
  select * into o from vendor_commercial where vendor_id = p_vendor for update;
  update vendor_commercial set
    quoted_amount_paise = case when p ? 'quotedAmountPaise' then nullif(p->>'quotedAmountPaise', '')::bigint else quoted_amount_paise end,
    contract_amount_paise = case when p ? 'contractAmountPaise' then nullif(p->>'contractAmountPaise', '')::bigint else contract_amount_paise end,
    payment_terms = case when p ? 'paymentTerms' then nullif(p->>'paymentTerms', '') else payment_terms end,
    contract_status = coalesce(nullif(p->>'contractStatus', ''), contract_status),
    updated_by = p_actor, updated_at = now()
  where vendor_id = p_vendor returning * into v;
  if v.quoted_amount_paise is distinct from o.quoted_amount_paise then d := d || '{"quoted_amount":{"changed":true}}'; end if;
  if v.contract_amount_paise is distinct from o.contract_amount_paise then d := d || '{"contract_amount":{"changed":true}}'; end if;
  if v.payment_terms is distinct from o.payment_terms then d := d || '{"payment_terms":{"changed":true}}'; end if;
  if v.contract_status is distinct from o.contract_status then d := d || jsonb_build_object('contract_status', jsonb_build_object('from', o.contract_status, 'to', v.contract_status)); end if;
  if d <> '{}' then perform audit(p_wedding, p_actor, 'vendor.commercial', p_vendor::text, d); end if;
  return v;
end $$;

-- p = {kind, amountPaise, dueAt?, paidAt?, method?, reference?, note?}
create or replace function vendor_add_payment(p_actor uuid, p_wedding uuid, p_vendor uuid, p jsonb)
returns vendor_payment language plpgsql set search_path = public as $$
declare v vendor_payment;
begin
  if not exists (select 1 from vendor where id = p_vendor and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  insert into vendor_payment(vendor_id, kind, amount_paise, due_at, paid_at, method, reference, note, created_by)
  values (p_vendor, p->>'kind', (p->>'amountPaise')::bigint, nullif(p->>'dueAt', '')::date, nullif(p->>'paidAt', '')::date,
          nullif(p->>'method', ''), nullif(p->>'reference', ''), nullif(p->>'note', ''), p_actor)
  returning * into v;
  perform audit(p_wedding, p_actor, 'vendor.payment', p_vendor::text, jsonb_build_object('payment_id', v.id, 'kind', v.kind, 'paid', v.paid_at is not null));
  return v;
end $$;

create or replace function vendor_add_note(p_actor uuid, p_wedding uuid, p_vendor uuid, p_body text, p_restricted boolean)
returns vendor_note language plpgsql set search_path = public as $$
declare v vendor_note;
begin
  if not exists (select 1 from vendor where id = p_vendor and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  insert into vendor_note(vendor_id, body, restricted, created_by) values (p_vendor, trim(p_body), p_restricted, p_actor) returning * into v;
  perform audit(p_wedding, p_actor, 'vendor.note', p_vendor::text, jsonb_build_object('restricted', p_restricted));
  return v;
end $$;

create or replace function vendor_add_document(p_actor uuid, p_wedding uuid, p_vendor uuid, p jsonb)
returns vendor_document language plpgsql set search_path = public as $$
declare v vendor_document;
begin
  if not exists (select 1 from vendor where id = p_vendor and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  if (p->>'storagePath') not like p_wedding::text || '/' || p_vendor::text || '/%' then raise exception 'BAD_REQUEST'; end if;
  insert into vendor_document(vendor_id, kind, file_name, storage_path, content_type, size_bytes, uploaded_by)
  values (p_vendor, p->>'kind', left(p->>'fileName', 200), p->>'storagePath', p->>'contentType', (p->>'sizeBytes')::int, p_actor)
  returning * into v;
  perform audit(p_wedding, p_actor, 'vendor.document.add', p_vendor::text, jsonb_build_object('document_id', v.id, 'kind', v.kind));
  return v;
end $$;

create or replace function vendor_delete_document(p_actor uuid, p_wedding uuid, p_document uuid)
returns vendor_document language plpgsql set search_path = public as $$
declare v vendor_document;
begin
  delete from vendor_document d using vendor x
   where d.id = p_document and x.id = d.vendor_id and x.wedding_id = p_wedding returning d.* into v;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform audit(p_wedding, p_actor, 'vendor.document.delete', v.vendor_id::text, jsonb_build_object('document_id', v.id, 'kind', v.kind));
  return v;
end $$;

insert into permission(key, description) values
  ('vendors.contacts.read', 'See the vendor directory and contact details'),
  ('vendors.manage', 'Add and edit vendors, contacts, function bookings, notes and documents'),
  ('vendors.commercial.read', 'See quotes, contract amounts, payments and restricted notes'),
  ('vendors.commercial.write', 'Edit commercial terms, record vendor payments, write restricted notes'),
  ('vendors.documents.read', 'View and download vendor documents')
on conflict (key) do update set description = excluded.description;
insert into role_permission(role_id, permission_key)
select r.id, k from role r, unnest(array['vendors.contacts.read','vendors.manage','vendors.commercial.read','vendors.commercial.write','vendors.documents.read']) k
 where r.key in ('super_admin','admin','host') and r.wedding_id is null
on conflict do nothing;
insert into role_permission(role_id, permission_key)
select r.id, 'vendors.contacts.read' from role r where r.key = 'coordinator' and r.wedding_id is null
on conflict do nothing;
insert into role_permission(role_id, permission_key)
select r.id, k from role r, unnest(array['vendors.contacts.read','vendors.commercial.read','vendors.commercial.write','vendors.documents.read']) k
 where r.key = 'finance' and r.wedding_id is null
on conflict do nothing;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets(id, name, public) values ('vendor-docs', 'vendor-docs', false) on conflict (id) do nothing;
  end if;
end $$;

select lock_down_public();
