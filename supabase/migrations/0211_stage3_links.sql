-- 0211_stage3_links.sql — Stage 3 cross-lane foreign keys, added once both sides exist:
-- task.vendor_id → vendor (0022 → 0210), thank_note.photo_id → photo (0121 → 0203).
-- NOT VALID first so existing rows are not scanned under lock, then validated.

do $$
begin
  if to_regclass('public.task') is not null and not exists (select 1 from pg_constraint where conname = 'task_vendor_fk') then
    update task set vendor_id = null where vendor_id is not null and not exists (select 1 from vendor v where v.id = task.vendor_id);
    alter table task add constraint task_vendor_fk foreign key (vendor_id) references vendor(id) on delete set null not valid;
    alter table task validate constraint task_vendor_fk;
  end if;
  if to_regclass('public.thank_note') is not null and not exists (select 1 from pg_constraint where conname = 'thank_note_photo_fk') then
    update thank_note set photo_id = null where photo_id is not null and not exists (select 1 from photo p where p.id = thank_note.photo_id);
    alter table thank_note add constraint thank_note_photo_fk foreign key (photo_id) references photo(id) on delete set null not valid;
    alter table thank_note validate constraint thank_note_photo_fk;
  end if;
end $$;

create index if not exists task_vendor_idx on task(vendor_id) where vendor_id is not null;

select lock_down_public();
