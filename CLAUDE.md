# Pehle Aap — repo conventions

Next.js 15 (App Router) · TypeScript strict · Tailwind v4 · Zod · Supabase Postgres (service role from the server) · GKE Autopilot + Helm (`deploy/`).

## Commands
| | |
|---|---|
| `npm run dev` | local app on :3000 (needs `supabase start` + `.env.local`) |
| `supabase db reset && npm run seed` | fresh local DB with the demo wedding; seed prints logins, codes, TV + check-in links |
| `npm run lint` / `npm run typecheck` / `npm test` | PR checks (CI) |
| `npm run test:integration` | DB tests; need `DATABASE_URL` (skip otherwise) |
| `npm run test:concurrency` | 50 parallel check-ins, 30 parallel call-next, key replay (needs `DATABASE_URL`) |
| `npm run test:e2e` | Playwright; needs seeded DB and `E2E_FAMILY_CODE` (code for 9876500040 from the seed output) |
| `supabase db push` | apply migrations to staging / prod (run before `deploy-prod`) |
| no Supabase locally? | any Postgres ≥15 works for SQL tests: apply `supabase/migrations/*.sql` in order, set `DATABASE_URL` (CI does this) |
| `npx tsx scripts/nudgebee-test.ts [--bad-signature]` | post a signed test recommendation (needs `APP_URL`, `NUDGEBEE_WEBHOOK_SECRET`) |
| `npm run migrate` | apply pending migrations (tracked in `pehle_meta.migration`; back-fills hand-migrated DBs). Also runs in prod as the Helm pre-upgrade hook |
| `npm run audit:routes` | fails if any route handler neither checks a permission nor calls `publicRoute("why")` (CI) |
| `npm run grant:super-admin -- <email>` | make an existing staff user a super admin (needs `DATABASE_URL`) |
| `npx tsx scripts/pregen-tts.ts` | pre-generate TV announcements 1–300 into the private `tts` bucket (costs Sarvam calls) |
| `npx tsx scripts/pregen-translations.ts [--langs=hi,ta,…]` | translate every screen text (`src/i18n/en.json`) once into the guest languages and store it in `translation` (costs Sarvam calls) |
| `npx tsx scripts/photo-demo.ts seed <folder> \| reset [--with-events]` | additive demo data for photo matching: stage events around the demo photos' capture times; reset removes the uploaded batch |
| `npx tsx scripts/pin-demo-families.ts` | pin two demo families to language group A / B and reset their language screen |
| `bash deploy/deploy-stage3.sh [--domain=HOST]` · `bash deploy/setup-https-endpoints.sh` · `node scripts/set-auth-urls.mjs https://HOST` | minimal-demo release · free `*.endpoints.<project>.cloud.goog` hostname · Supabase sign-in URLs |
| `bash deploy/gcp-deploy.sh` | one-command production deploy to GKE (see `deploy/README.md`) |
| `bash deploy/deploy-stage1.sh` / `deploy-stage2.sh` / `rollback-stage2.sh` | deploy tag stage-1 · upgrade to Stage 2 with verification · reverse Stage 2 (data kept) |
| `node scripts/create-staff-user.mjs <email>` | create a staff login with a generated password (shown once); roles via admin UI |
| deploy / rollback | `deploy/README.md` |

## Rules
- **All multi-row writes are Postgres functions** (`0002_queue.sql`, `0101_guest.sql`, `02xx`), called via `rpc()` in `src/lib/db/service.ts`. One function = one transaction. SQL raises a stable code (`QUEUE_PAUSED` …) that `rpc()` turns into `AppError`; `src/lib/errors.ts` maps codes to HTTP.
- **Every API route checks permission server-side** with `requirePermission` (or a guard that calls it: `authorizeEvent`, `requireAdmin`, `ledgerAccess`, `resolveCaller`) before calling the service client, or is marked `publicRoute("reason")`. `npm run audit:routes` enforces this in CI. The service client bypasses RLS.
- **Permissions live in Postgres** (Stage 2): `authz.effective_permissions(user, wedding)` — active user, assignment window, role permission, wedding match, wedding-less `super_admin`. `requirePermission` (frozen signature) resolves them once per request, then applies E2's grant-only Flagsmith overrides. `src/lib/authz/staticMap.ts` is a **test fixture** that must equal the defaults in `0010_rbac.sql`. Suspended users get 403 everywhere; the last active super admin cannot be removed (DB trigger).
- **PinkyBua** (`src/lib/assistant`): tools call domain services with the caller's scope; the list is filtered by permission before the model sees it and re-checked at execution; write tools only propose (single-use token, 5 min, args hash, permission re-check, audited on confirm). The model never gets secrets or DB access. Add tools in `src/lib/assistant/tools/index.ts`.
- **No mock integrations outside the test suite** (`src/lib/mockPolicy.ts`, NODE_ENV=test): anywhere else a missing Sarvam/Flagsmith key means "off" with safe fallbacks.
- **RLS is on with no policies**: the browser's anon key can read nothing. Do not add policies in Stage 1.
- **stage_log, ledger_entry, ledger_reconciliation are append-only** (triggers). Never UPDATE/DELETE; write a new row (ledger corrections = reversing entry + new entry). `photo.captured_at` is immutable.
- **Every migration ends with `select lock_down_public();`** (0003) — new functions are otherwise EXECUTE-able by PUBLIC, i.e. the anon key via `/rpc`. An integration test enforces this.
- **Ledger amounts need `ledger.read`**, enforced in `src/domain/ledger` (`toApiRow` removes the `amount` key); export needs `ledger.read` + `ledger.export`. Add, reverse, reconcile and export write `audit_log` (no amounts in audit data).
- **What goes to Sarvam / Flagsmith**: translation and TTS get only static UI copy, approved invitation text and token announcements. PinkyBua (Sarvam chat, `sarvam-105b`) receives the caller's question and the results of tools that caller is allowed to use (role-scoped; never phone numbers, never other families for guests). Flagsmith identities are `wedding:<id>:role:<role>`. Metric labels are fixed enums.
- **Every external call** (Sarvam, Flagsmith, NudgeBee) has a timeout, a mock mode (empty key) and a safe fallback.
- **Photos are matched by time only** — no face recognition, never auto-confirmed.
- **The TV never sees PII.** It reads `tv_feed` only (token, next_token, instruction, language, announcement_id). Do not add columns to `tv_feed` or join anything into TV routes.
- Mutating queue routes require an `Idempotency-Key` header; the client generates one per press and reuses it on retry (`src/domain/queue/idempotency.ts`).
- No `NEXT_PUBLIC_*` env: the server hands Supabase URL + anon key to the login form, so one image runs in staging and prod.
- Migrations: E1 `0001`–`0099`, E2 `0101`–`0199`, E3 `0201`–`0299`. Every migration must be safe to apply to a database that already has later-numbered migrations (ranges interleave).

## Folder ownership
| Path | Owner |
|---|---|
| `src/lib/db`, `src/lib/authz`, `src/lib/http.ts`, `src/lib/log.ts`, `src/lib/env.ts`, `src/lib/errors.ts`, `src/lib/clock.ts`, `src/contracts/admin.ts`, `src/domain/admin`, `src/app/api/admin`, `src/app/login` | E1 |
| `src/domain/queue`, `src/domain/checkin`, `src/contracts/queue.ts` | E1 |
| `src/app/(stage)`, `src/app/(tv)`, `src/app/checkin`, `src/app/login`, `src/app/api/{queue,checkin,clock,tv/feed,tv/stream,health,events,auth}` | E1 |
| `supabase/migrations/00xx`, `scripts/`, `deploy/` (except `deploy/monitoring`), `.github/` | E1 |
| `src/app/(guest)`, `src/domain/rsvp`, `src/i18n`, `src/middleware.ts`, `src/lib/{sarvam,flags,metrics,nudgebee,assistant}`, `src/components/pinkybua`, `src/app/api/assistant`, `tests/assistant` | E2 |
| `src/app/api/{tv/announcement,tv/telemetry,metrics,guest,integrations,ops}`, `src/app/(ops)`, `deploy/monitoring`, `supabase/migrations/01xx` | E2 |
| `src/app/{(host),(kitchen),(admin),(photographer),(ledger)}`, `src/components/shell` (incl. `useWedding()`), `src/domain/{ledger,photos,host}`, `tests/e2e` | E3 |
| `src/app/api/{ledger,photos,host,kitchen}`, `supabase/migrations/02xx` | E3 |

If you need a change in another lane, stop and ask its owner.

## Minimal demo scope (9-hour plan)
- **PinkyBua** is active for **admin and super admin only** (staff) and for **guests on their family link**; every other staff role sees a greyed "coming soon" button, and `resolveCaller("staff")` refuses them. One topic per audience, in `src/lib/assistant/scope.ts`: staff → `photo_review_counts`, guest → `my_rsvp`. Widening later = add names there. The full tool registry and `allowedFor()` (permissions) are unchanged.
- **Guest language A/B test.** First screen of a family link = language picker (nothing else until chosen). Group A: English + Hindi; group B: all ten (dropdown for the eight others). The group is assigned by **our app** (`src/domain/rsvp/group.ts`, stable hash of the family id) and saved in `family.language_group`; Flagsmith holds only the split percentage (`pinkybua_languages`, flag value 0–100, OFF = 0). **No guest id is sent to Flagsmith** (identities stay `wedding:<id>:role:<role>`). The chosen language drives screen text, PinkyBua text and Sarvam voice.
- **Static tiles** (`/demo/vendors|readiness|tasks|ledger`, data in `src/lib/demo/staticTiles.ts`): fixed invented data, Preview label, Add button says "Demo only". The real vendor, task, wishlist, thank-you and ledger screens stay in the repo, unlinked. Menu: `src/components/shell/navConfig.ts`.
- **Voice**: Sarvam speech-to-text/text-to-speech in PinkyBua. If Sarvam is forced to fail (`SARVAM_FORCE_FAIL=1` or the Flagsmith flag `sarvam_force_fail`) or `voice_calls` is OFF, the widget drops to English text chat. The microphone needs https or localhost.
- **Family album** `/f/<link key>/album`: only photos a person confirmed for that family, grouped by function. The venue TV announcements stay English/Hindi (`isTvLanguage`).

## Contracts
| | Interface | Provider → consumer |
|---|---|---|
| C1 | Schema v0, seed, `getSession()`, `requirePermission(ctx, key, weddingId)` (**frozen signature**), `.env.example` | E1 → E2, E3 |
| C2 | `getQueueStatus(familyId, eventId)` from `@/domain/queue` → `QueueStatus` (`src/contracts/queue.ts`) | E1 → E2 family pass |
| C3 | `GET /api/tv/announcement/:id/audio?key=<tv_key>` → 200 `audio/*`, or 204 when TTS is off/failed (TV chimes; also after 3.5 s); `announcementText(token, lang)` in `src/lib/sarvam/announcement.ts` | E2 → E1 TV |
| C4 | `GET /api/clock/now` → `{ t_ms, sig, qr }`, `qr = "PA|<t_ms>|<sig>"`, sig = hex HMAC-SHA256(`CLOCK_HMAC_SECRET`, t_ms); `verifyClockQr()` in `src/lib/clock.ts` | E1 → E3 photographer |
| — | `POST /api/tv/telemetry { event: "chime", eventId, key, announcementId, reason }` → 204 (bad key 403) | E1 TV → E2 |
| C5 | `getT(lang, weddingId, extra?)` → `t(key)` (`src/i18n`), `<LanguageSelect />` | E2 → all |
| C6 | `rsvp(family_id, event_id, status 'pending'\|'yes'\|'no', headcount 0..10, updated_at)`; save via `rsvp_save()` | E2 → E3 |
| — | `applyOverrides(ctx, key, baseDecision)` (`src/lib/flags/overrides.ts`), called inside `requirePermission`; grant-only, allowlisted roles, fail → baseline | E2 → E1 |
| — | `v_event_plates`, `v_ledger_entry`, `src/domain/ledger`, `src/domain/photos` | E3 → E1, E2 |

## Stage 2 contracts
| | Interface | Provider → consumer |
|---|---|---|
| C7 | Postgres-backed `requirePermission`, permission catalogue (`src/lib/authz/catalogue.ts`), `Session.permissions` / `weddings` | E1 → E2, E3 |
| C8 | Admin API (`src/contracts/admin.ts`): users, assignments, roles, audit, weddings, families import, rotate-link | E1 → E3 admin + families UI |
| C9 | `<PinkyBua mode />`, `/api/assistant/{message,confirm,cancel}`, tool registry | E2 → all |
| C10 | `useWedding()` / `<WeddingSelect />` (selected wedding cookie `pa_wedding`), Playwright harness `tests/e2e/harness.ts` | E3 → all |

## API (E1)
| Route | Auth | Notes |
|---|---|---|
| `POST /api/checkin/verify` `{phone, code, eventId}` | public | same error for unknown phone / wrong code; 5 fails in 15 min → `CHECKIN_LOCKED` (429) |
| `POST /api/checkin/walk-in` `{eventId, name, phone?, language}` | `queue.checkin` | |
| `POST /api/checkin/desk` `{eventId, familyId}` | `queue.checkin` | |
| `GET /api/checkin/lookup?eventId&q` | `queue.checkin` | name, phone digits or token |
| `GET /api/queue/:event` | `queue.read` | console snapshot (has names) |
| `POST /api/queue/:event/call-next` | `queue.call_next` + Idempotency-Key | 409 `QUEUE_PAUSED` / `QUEUE_EMPTY` |
| `POST /api/queue/:event/{on-stage,served,no-show,pause,resume}` `{entryId?}` | `queue.manage` + Idempotency-Key | |
| `POST /api/queue/:event/skip` `{entryId}` | `queue.skip` + Idempotency-Key | stage gets `queue.skip` via Flagsmith `queue_skip_override`; 2nd skip → automatic no_show |
| `GET /api/clock/now` | `clock.read` | C4 |
| `GET /api/tv/stream?eventId&key` (SSE), `GET /api/tv/feed?eventId&key` | TV key | tokens only |
| `GET /api/health` | public | `{ ok: true, sha }` |

## API (E2)
| Route | Auth | Notes |
|---|---|---|
| `GET /f/:key`, `/f/:key/pass` | link key | middleware sets signed `pa_family` cookie (`GUEST_COOKIE_SECRET`) |
| `PUT /api/guest/rsvp` `{rsvps:[{eventId, attending, headcount}]}` | family cookie | one transaction |
| `POST /api/guest/language` `{language}`, `GET /api/guest/status?eventId` | family cookie | status = C2 for that family only |
| `GET /api/tv/announcement/:id/audio?key` | TV key | C3 |
| `GET /api/metrics` | `Bearer METRICS_TOKEN` | Prometheus |
| `POST /api/integrations/nudgebee/recommendation` | HMAC `x-nudgebee-signature` + `x-nudgebee-timestamp` | stores `pending` only |
| `POST /api/ops/recommendations/:id/approve` | `ops.approve` | Flagsmith Admin → voice_calls OFF → read-back; `done` only if OFF |

## API (E3)
| Route | Auth | Notes |
|---|---|---|
| `GET /api/ledger?eventId&date&token&method&reconciliation` | `ledger.read` or `ledger.write` | no `amount` key / totals without `ledger.read` |
| `POST /api/ledger`, `POST /api/ledger/:id/{reverse,reconcile}`, `GET /api/ledger/families?q` | `ledger.write` | immutable entries |
| `GET /api/ledger/export` | `ledger.read` + `ledger.export` | CSV, audited |
| `POST /api/photos/batches`, `…/:id/uploads`, `…/:id/photos`, `…/:id/calibrate` | `photos.upload` | signed upload URLs; QR verified server-side |
| `POST /api/photos/candidates/:id` `{decision}` | `photos.review` | human confirm/reject |
| `POST /api/host/family`, `POST /api/host/event` | `family.write` / `event.write` | add family returns the one-time code |
| `POST /api/kitchen/meal-status` | `kitchen.write` | |

## API (Stage 2)
| Route | Auth | Notes |
|---|---|---|
| `/api/admin/*` | see `src/contracts/admin.ts` | users.manage · roles.manage (super admin) · weddings.manage (super admin) · audit.read · families.write |
| `PUT /api/host/families/:id/rsvp` | `rsvp.manage` | edit on behalf of a family, audited |
| `POST /api/session/wedding` `{weddingId}` | signed in | only weddings the user can access |
| `POST /api/assistant/message` `{mode, sessionId?, text}` | `assistant.use` or family cookie | ≤4 model calls, 20 s timeout, friendly errors |
| `POST /api/assistant/confirm` `{mode, actionId, token}` / `cancel` | same | 403 ACTION_INVALID · 409 ACTION_USED · 410 ACTION_EXPIRED |

## Open items to reconcile
- Permission keys in `src/lib/authz/staticMap.ts` vs spec §3.3.
- Env names in `.env.example` vs doc_00 §8.
- Table shapes vs Engineering Implementation Guide §4/§6 (built from the lane docs).
- NudgeBee: webhook format and telemetry path are not yet confirmed with NudgeBee; adapt `src/lib/nudgebee/signature.ts` only.
- `queue.skip` for stage depends on the Flagsmith flag (doc_e2 T7). With Flagsmith configured but down, stage cannot SKIP (baseline). Confirm this is wanted for the wedding day, or add `queue.skip` to the stage baseline.
- doc_e2 says the guest cookie is "signed with APP_BASE_URL secret"; implemented as `GUEST_COOKIE_SECRET`.
- Stage 2 default role permission sets (spec §3.2) are interpreted in `0010_rbac.sql`; confirm with the spec owner. Notably stage managers no longer see Families (phones), coordinators have no ledger access.
- PinkyBua runs on Sarvam chat (owner's decision) instead of doc_e2_s2's default Anthropic provider; Anthropic remains selectable with ASSISTANT_PROVIDER=anthropic. Real-model eval (`tests/assistant/RESULTS.md`) not yet run.
- Supabase Auth → URL Configuration must allow `<APP_URL>/login/accept` for invite links.
