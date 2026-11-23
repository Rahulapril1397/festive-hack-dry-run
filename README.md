# Pehle Aap

Wedding guest queue, stage console, venue TV, guest RSVP, photographer matching and shagun ledger.
Conventions, contracts and API: [CLAUDE.md](CLAUDE.md). Deploy and rollback: [deploy/README.md](deploy/README.md).

## Quickstart

```bash
npm install
cp .env.example .env.local          # fill Supabase keys from `supabase start`
supabase start && supabase db reset # applies supabase/migrations
npm run seed                        # prints staff logins, family codes and links, TV links
npm run dev                         # http://localhost:3000
```

Sarvam, Flagsmith and NudgeBee run in mock mode while their keys are empty.

## Checks

```bash
npm run lint && npm run typecheck && npm test   # unit (+ integration when DATABASE_URL is set)
npm run test:concurrency                        # needs DATABASE_URL
npm run test:e2e                                # needs seeded app; E2E_FAMILY_CODE from seed output
```
