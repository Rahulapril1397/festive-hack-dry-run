# Deploying Pehle Aap (GKE Autopilot)

**Per stage (recommended):**

| Script | Use |
|---|---|
| `bash deploy/deploy-stage1.sh --project=…` | first install, or redeploy, of the code at tag `stage-1` (built from `.deploy/stage1-src`; refuses if prod is on Stage 2) |
| `bash deploy/deploy-stage2.sh --project=…` | upgrade a running Stage 1 to Stage 2 (or redeploy Stage 2); creates the super admin login if needed |
| `bash deploy/rollback-stage2.sh --project=…` | Stage 2 → Stage 1 (only acts if prod is on Stage 2) |

`deploy/gcp-deploy.sh` is the engine both stage scripts call.

**Stage 2 upgrade (on top of a running Stage 1):** `bash deploy/deploy-stage2.sh` — checks,
backup, deploy, super admin, automatic verification. Roll back with `bash deploy/rollback-stage2.sh`
(helm rollback + `deploy/stage2-down.sql`, which restores the Stage 1 schema and keeps all data).

**Quick path (production only, one command):** `bash deploy/gcp-deploy.sh` — reads `.env.local`,
creates or reuses everything below (APIs, registry, Autopilot cluster, static IP, Secret Manager +
External Secrets, migrations via `npm run migrate`, Cloud Build image, helm release) and is safe to
re-run. `--help` lists options (`--domain=`, `--secrets=k8s`, `--skip-build`). The sections below are
the manual / CI (staging + prod) path.

One image, two namespaces: `staging` (1 replica) and `prod` (2 replicas). Merges to `main`
build the image and `helm upgrade` into `staging`; `deploy-prod` (manual) promotes an image
already running on staging into `prod`.

## Day 0 — one-time setup

```bash
PROJECT=…; REGION=asia-south1; REPO=pehle; CLUSTER=pehle-aap; GH_REPO=org/festive-hack-dry-run

gcloud container clusters create-auto $CLUSTER --region $REGION --project $PROJECT
gcloud container clusters get-credentials $CLUSTER --region $REGION
kubectl create namespace staging && kubectl create namespace prod

gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION

# Static IPs for the Ingresses (names match values-*.yaml)
gcloud compute addresses create pehle-aap-staging-ip --global
gcloud compute addresses create pehle-aap-prod-ip --global
```

**GitHub → GCP (Workload Identity Federation).** Create a pool + OIDC provider for
`token.actions.githubusercontent.com` restricted to `assertion.repository == "$GH_REPO"`, and a
deploy service account with `roles/artifactregistry.writer` and `roles/container.developer`,
bound with `roles/iam.workloadIdentityUser` to the pool principal. Set these repo variables:
`GCP_PROJECT`, `GCP_REGION`, `AR_REPO`, `GKE_CLUSTER`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`,
`STAGING_URL`, `PROD_URL`. Protect the `production` environment with required reviewers.

**Secrets (Secret Manager → pod via Workload Identity).**

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace

for ns in staging prod; do
  gcloud iam service-accounts create pehle-aap-$ns
  gcloud projects add-iam-policy-binding $PROJECT \
    --member serviceAccount:pehle-aap-$ns@$PROJECT.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
  gcloud iam service-accounts add-iam-policy-binding pehle-aap-$ns@$PROJECT.iam.gserviceaccount.com \
    --role roles/iam.workloadIdentityUser --member "serviceAccount:$PROJECT.svc.id.goog[$ns/pehle-aap]"
done
```

Create one secret per entry in `externalSecrets.keys` (values.yaml), prefixed `staging-` / `prod-`
(e.g. `staging-pehle-supabase-url`). Point DNS for each host at its static IP;
the ManagedCertificate turns Active within ~15–60 minutes.

**Database.** Migrations are applied by hand before a deploy that needs them:
`supabase link --project-ref … && supabase db push` (staging first, then prod).

## Deploy

| | |
|---|---|
| staging | merge to `main` (or run *deploy-staging*). Done when `$STAGING_URL/api/health` shows the new `sha`. |
| prod | *Actions → deploy-prod → Run*, input = the SHA verified on staging. |

## Stage 2 hardening

- **Prod shape:** 2 replicas, rolling updates with `maxUnavailable: 0`, a PodDisruptionBudget
  (`minAvailable: 1`), readiness/liveness/startup probes on `/api/health`.
- **Migrations before traffic:** every `helm upgrade` runs the `pehle-aap-migrate` pre-upgrade hook
  Job (`node scripts/migrate.mjs`, image's own copy of `supabase/migrations`) before any new pod is
  created. A failed migration fails the upgrade; the old pods keep serving. First install: the
  deploy script migrates before helm (the secret store the hook reads does not exist yet).
  Applied migrations are tracked in `pehle_meta.migration`.
- **Logs:** pods write one JSON line per request to stdout (Cloud Logging parses `severity`):
  `requestId, method, route, status, latencyMs, error`. Never phones, names, amounts, keys or query
  strings (`src/lib/log.ts` scrubs free text). Find slow or failing calls:
  `gcloud logging read 'resource.type="k8s_container" AND jsonPayload.message="request" AND jsonPayload.status>=500' --limit 50`
- **Uptime:** Cloud Monitoring uptime check `pehle-aap-health` on `/api/health` every minute
  (created by the deploy script). Add an alert policy on it in Cloud Monitoring → Alerting.
- **Prod has no seed** by default; the demo wedding is seeded only on request. Real weddings are
  created by a super admin (Users and Roles → Weddings) and families imported by CSV.
- **First super admin:** `DATABASE_URL=… npm run grant:super-admin -- you@example.com`.

### Backup before each stage release

```bash
supabase db dump --db-url "$DATABASE_URL" -f backup-$(date +%F).sql          # schema + data
supabase db dump --db-url "$DATABASE_URL" --data-only -f data-$(date +%F).sql
# without the Supabase CLI:  pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%F).dump
```
Keep the file outside the repo (it contains phones and ledger data).

### Staging ↔ prod parity checklist

Run before promoting to prod; every line should match (or differ only where noted).

| Check | Command | Expect |
|---|---|---|
| Helm values | `diff <(helm get values pehle-aap -n staging -a) <(helm get values pehle-aap -n prod -a)` | only `appEnv`, `appUrl`, `ingress.*`, `replicaCount` (1 vs 2), `resources`, `externalSecrets.prefix`, `serviceAccount` |
| Image | `kubectl get deploy pehle-aap -n {staging,prod} -o jsonpath='{..image}'` | prod = the tag verified on staging |
| Secrets present | `gcloud secrets list --filter='name~staging-pehle' --format='value(name)' \| sed 's/staging-//'` vs the same for `prod-` | same set |
| Secrets synced | `kubectl get externalsecret -n {staging,prod}` | `SecretSynced`, Ready=True |
| Env var names | `kubectl exec -n {ns} deploy/pehle-aap -- printenv \| cut -d= -f1 \| sort` | same names |
| Migration version | `psql "$DATABASE_URL" -Atc "select max(name) from pehle_meta.migration"` | same on both databases |
| Super admin | `psql "$DATABASE_URL" -Atc "select authz.active_super_admins()"` | ≥ 1 |

## Rollback

```bash
helm history pehle-aap -n prod
helm rollback pehle-aap <REVISION> -n prod --wait
# or, for the Deployment only:
kubectl rollout undo deployment/pehle-aap -n prod
kubectl rollout status deployment/pehle-aap -n prod
```

Rolling back the app does **not** roll back migrations. Stage 1 and Stage 2 migrations are additive
for the previous release except `0010_rbac.sql`, which renames the `stage` role to `stage_manager`
and replaces the Stage 1 `session_role()` function: a Stage 1 image can no longer sign anyone in.
To roll back across Stage 2, restore the pre-release backup (above) as well.

## Smoke checklist (staging, then prod)

1. Log in as stage user; open the console for Reception.
2. On a phone, check in two seeded families at `/checkin`; tokens differ.
3. Add one walk-in at the desk.
4. Open the TV page on a second screen; CALL NEXT; token appears and audio or chime plays.
5. Double-tap CALL NEXT; only one family is called.
6. PAUSE, then CALL NEXT shows "queue paused"; RESUME works.
7. Set `SARVAM_FORCE_FAIL=1` (`helm upgrade … --set env.SARVAM_FORCE_FAIL=1`); chime plays, queue continues.
8. Guest: open a family link, switch to Hindi, save RSVP; the pass shows token and position.
9. Finance: add cash + UPI entries; totals correct; export downloads. Kitchen: `/ledger` is denied.
10. Photographer: calibrate with the stage QR, upload, confirm one candidate.
11. NudgeBee: signed test recommendation → approve → flag reads back OFF.
