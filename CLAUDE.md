# Pehle Aap — repo conventions

Next.js 15 (App Router) · TypeScript strict · Tailwind v4 · Zod · Supabase Postgres (service role from the server) · Cloud Run.

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

## Rules
- **All multi-row writes are Postgres functions** (`supabase/migrations/0002_queue.sql`), called via `rpc()` in `src/lib/db/service.ts`. One function = one transaction. SQL raises a stable code (`QUEUE_PAUSED` …) that `rpc()` turns into `AppError`; `src/lib/errors.ts` maps codes to HTTP.
- **Every API route checks permission server-side** with `requirePermission` (or `authorizeEvent`) before calling the service client. The service client bypasses RLS.
- **RLS is on with no policies**: the browser's anon key can read nothing. Do not add policies in Stage 1.
- **stage_log is append-only** (trigger). Never UPDATE/DELETE it; write a new row.
- **The TV never sees PII.** It reads `tv_feed` only (token, next_token, instruction, language, announcement_id). Do not add columns to `tv_feed` or join anything into TV routes.
- Mutating queue routes require an `Idempotency-Key` header; the client generates one per press and reuses it on retry (`src/domain/queue/idempotency.ts`).
- No `NEXT_PUBLIC_*` env: the server hands Supabase URL + anon key to the login form, so one image runs in staging and prod.
- Migrations: E1 owns `0001`–`0099`. Other lanes use their own ranges.

## Folder ownership
| Path | Owner |
|---|---|
| `src/lib/db`, `src/lib/authz`, `src/lib/http.ts`, `src/lib/env.ts`, `src/lib/errors.ts`, `src/lib/clock.ts` | E1 |
| `src/domain/queue`, `src/domain/checkin`, `src/contracts/queue.ts` | E1 |
| `src/app/(stage)`, `src/app/(tv)`, `src/app/checkin`, `src/app/login`, `src/app/api/{queue,checkin,clock,tv/feed,tv/stream,health,events,auth}` | E1 |
| `src/app/api/tv/announcement/*`, `src/app/api/tv/telemetry` | **E2** (E1 ships stubs) |
| `supabase/migrations/00xx`, `scripts/` | E1 |

If you need a change in another lane, stop and ask its owner.

## Contracts
| | Interface | Provider → consumer |
|---|---|---|
| C1 | Schema v0, seed, `getSession()`, `requirePermission(ctx, key, weddingId)` (**frozen signature**), `.env.example` | E1 → E2, E3 |
| C2 | `getQueueStatus(familyId, eventId)` from `@/domain/queue` → `QueueStatus` (`src/contracts/queue.ts`) | E1 → E2 family pass |
| C3 | `GET /api/tv/announcement/:id/audio` → 200 `audio/*` (else TV chimes after 3.5 s); `announcementText` | E2 → E1 TV |
| C4 | `GET /api/clock/now` → `{ t_ms, sig, qr }`, `qr = "PA|<t_ms>|<sig>"`, sig = hex HMAC-SHA256(`CLOCK_HMAC_SECRET`, t_ms); `verifyClockQr()` in `src/lib/clock.ts` | E1 → E3 photographer |
| — | `POST /api/tv/telemetry { event: "chime", eventId, announcementId, reason }` | E1 TV → E2 |

## API (E1)
| Route | Auth | Notes |
|---|---|---|
| `POST /api/checkin/verify` `{phone, code, eventId}` | public | same error for unknown phone / wrong code; 5 fails in 15 min → `CHECKIN_LOCKED` (429) |
| `POST /api/checkin/walk-in` `{eventId, name, phone?, language}` | `queue.checkin` | |
| `POST /api/checkin/desk` `{eventId, familyId}` | `queue.checkin` | |
| `GET /api/checkin/lookup?eventId&q` | `queue.checkin` | name, phone digits or token |
| `GET /api/queue/:event` | `queue.read` | console snapshot (has names) |
| `POST /api/queue/:event/call-next` | `queue.call_next` + Idempotency-Key | 409 `QUEUE_PAUSED` / `QUEUE_EMPTY` |
| `POST /api/queue/:event/{skip,on-stage,served,no-show,pause,resume}` `{entryId?}` | `queue.manage` + Idempotency-Key | 2nd skip → automatic no_show |
| `GET /api/clock/now` | `clock.read` | C4 |
| `GET /api/tv/stream?eventId&key` (SSE), `GET /api/tv/feed?eventId&key` | TV key | tokens only |
| `GET /api/health` | public | `{ ok: true, sha }` |

## Open items to reconcile
- Permission keys in `src/lib/authz/staticMap.ts` vs spec §3.3.
- Env names in `.env.example` vs doc_00 §8.
- Table shapes vs Engineering Implementation Guide §4/§6 (built from this lane's doc; E2/E3 refine their tables).
