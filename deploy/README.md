# Deploying Pehle Aap (GKE Autopilot)

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

Create one secret per entry in `externalSecrets.keys` (values.yaml). Use separate projects or
name prefixes if staging and prod must not share values. Point DNS for each host at its static IP;
the ManagedCertificate turns Active within ~15–60 minutes.

**Database.** Migrations are applied by hand before a deploy that needs them:
`supabase link --project-ref … && supabase db push` (staging first, then prod).

## Deploy

| | |
|---|---|
| staging | merge to `main` (or run *deploy-staging*). Done when `$STAGING_URL/api/health` shows the new `sha`. |
| prod | *Actions → deploy-prod → Run*, input = the SHA verified on staging. |

## Rollback

```bash
helm history pehle-aap -n prod
helm rollback pehle-aap <REVISION> -n prod --wait
# or, for the Deployment only:
kubectl rollout undo deployment/pehle-aap -n prod
kubectl rollout status deployment/pehle-aap -n prod
```

Rolling back the app does **not** roll back migrations; migrations are additive in Stage 1.

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
