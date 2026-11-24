-- 0122_languages.sql — guest language A/B test (E2): the other Indian languages Sarvam provides,
-- and the group (A or B) each family was placed in. Group A: English + Hindi. Group B: all ten.
-- Verified with Sarvam: translate, text-to-speech and speech-to-text work for every one of them.

alter type app_language add value if not exists 'bn';
alter type app_language add value if not exists 'ta';
alter type app_language add value if not exists 'te';
alter type app_language add value if not exists 'mr';
alter type app_language add value if not exists 'gu';
alter type app_language add value if not exists 'kn';
alter type app_language add value if not exists 'ml';
alter type app_language add value if not exists 'pa';

-- Set once on the family's first visit (hash of the family id against the Flagsmith split); never changes.
alter table family add column if not exists language_group text check (language_group in ('A','B'));

select lock_down_public();
