-- 0204_live.sql — Stage 2 (E3): resumable uploads (content hash), paged review.

alter table photo add column if not exists content_hash text check (content_hash ~ '^[0-9a-f]{64}$');
create unique index if not exists photo_batch_hash_uidx on photo(batch_id, content_hash) where content_hash is not null;
create index if not exists photo_review_idx on photo(review_status, corrected_at);

-- Kitchen shows who last changed meal status (PostgREST embeds need the foreign key).
alter table meal_status drop constraint if exists meal_status_updated_by_fkey;
alter table meal_status add constraint meal_status_updated_by_fkey foreign key (updated_by) references app_user(id) on delete set null not valid;

select lock_down_public();
