#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────
# Pehle Aap → GCP (GKE Autopilot), production only. Safe to re-run: every step checks first.
#
#   bash deploy/gcp-deploy.sh                       # interactive
#   bash deploy/gcp-deploy.sh --domain=pehle.example.com
#   bash deploy/gcp-deploy.sh --yes                 # no prompts (keeps defaults)
#
# Options (flags or environment variables):
#   --project=ID     GCP_PROJECT   GCP project id (default: gcloud's current project)
#   --region=R       GCP_REGION    GKE + Artifact Registry region (default: nearest to the Supabase DB)
#   --domain=HOST    DOMAIN        HTTPS on this host (A record → the static IP). Empty = http://<IP>
#   --secrets=MODE   SECRETS_MODE  secretmanager (default: Secret Manager + External Secrets) | k8s
#   --skip-build                   redeploy the last built image
#   --super-admin=EMAIL            make this existing staff user a super admin after deploying
#   --skip-backup                  do not pg_dump the database first (not recommended)
#   --no-jobs                      do not schedule the background-jobs CronJob (the minimal demo needs none)
#   BACKUP_DIR=…                   where backups go (default ~/pehle-backups, outside the repo)
#   --tools-only                   only download helm/kubectl into .deploy/bin
#   --yes            YES=1
#
# Reads Supabase settings from .env.local. Needs: gcloud (logged in), node + npm. Installs nothing
# system-wide: helm and kubectl are downloaded (checksum-verified) into .deploy/bin, and kubectl
# authenticates with a short-lived gcloud access token (no gke-gcloud-auth-plugin, no sudo).
# ──────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HELM_VERSION="v3.17.3"
KUBECTL_VERSION="v1.32.3"
CLUSTER="pehle-aap"
NAMESPACE="prod"
AR_REPO="pehle"
RELEASE="pehle-aap"
IP_NAME="pehle-aap-prod-ip"
GSA_NAME="pehle-aap-prod"
SECRET_PREFIX="prod-"
CHART="deploy/helm/pehle-aap"
WORK="$ROOT/.deploy"
mkdir -p "$WORK/bin"
chmod 700 "$WORK"
export PATH="$WORK/bin:$PATH"
export KUBECONFIG="$WORK/kubeconfig"

GCP_PROJECT="${GCP_PROJECT:-}"; GCP_REGION="${GCP_REGION:-}"; DOMAIN="${DOMAIN-__unset__}"
SECRETS_MODE="${SECRETS_MODE:-secretmanager}"; YES="${YES:-0}"; SKIP_BUILD=0; TOOLS_ONLY=0
SUPER_ADMIN_EMAIL="${SUPER_ADMIN_EMAIL:-}"; JOBS_CRON=true; SKIP_BACKUP=0; BACKUP_DIR="${BACKUP_DIR:-$HOME/pehle-backups}"
for a in "$@"; do
  case "$a" in
    --project=*) GCP_PROJECT="${a#*=}" ;;
    --region=*) GCP_REGION="${a#*=}" ;;
    --domain=*) DOMAIN="${a#*=}" ;;
    --secrets=*) SECRETS_MODE="${a#*=}" ;;
    --skip-build) SKIP_BUILD=1 ;;
    --tools-only) TOOLS_ONLY=1 ;;
    --super-admin=*) SUPER_ADMIN_EMAIL="${a#*=}" ;;
    --skip-backup) SKIP_BACKUP=1 ;;
    --no-jobs) JOBS_CRON=false ;;
    -y|--yes) YES=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 2 ;;
  esac
done

# ── output helpers ────────────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'; else B=; G=; Y=; R=; D=; N=; fi
STEP=0; CURRENT="start"
step() { STEP=$((STEP + 1)); CURRENT="$*"; printf "\n${B}[%02d] %s${N}\n" "$STEP" "$*"; }
ok()   { printf "  ${G}✓${N} %s\n" "$*"; }
info() { printf "  ${D}·${N} %s\n" "$*"; }
warn() { printf "  ${Y}!${N} %s\n" "$*"; }
die()  { printf "\n${R}✗ %s${N}\n" "$*" >&2; exit 1; }
trap 'printf "\n${R}✗ Failed during: %s (line %s).${N} Fix the problem above and re-run; finished steps are skipped.\n" "$CURRENT" "$LINENO" >&2' ERR

ask() { # ask "question" default → echoes answer
  local q="$1" def="${2:-}" ans=""
  if [ "$YES" = "1" ] || [ ! -r /dev/tty ]; then echo "$def"; return; fi
  read -r -p "  ? $q " ans </dev/tty || true
  echo "${ans:-$def}"
}
confirm() { local a; a="$(ask "$1 [y/N]" "n")"; [ "$YES" = "1" ] || case "$a" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

# ── tools ─────────────────────────────────────────────────────────────────────────────────────
install_tools() {
  local os arch tmp
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "Unsupported OS $(uname -s)" ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; *) die "Unsupported CPU $(uname -m)" ;; esac
  tmp="$(mktemp -d)"
  if [ ! -x "$WORK/bin/helm" ]; then
    info "downloading helm $HELM_VERSION"
    curl -fsSL "https://get.helm.sh/helm-$HELM_VERSION-$os-$arch.tar.gz" -o "$tmp/helm.tgz"
    curl -fsSL "https://get.helm.sh/helm-$HELM_VERSION-$os-$arch.tar.gz.sha256sum" -o "$tmp/helm.sha"
    [ "$(sha256 "$tmp/helm.tgz")" = "$(awk '{print $1}' "$tmp/helm.sha")" ] || die "helm checksum mismatch"
    tar -xzf "$tmp/helm.tgz" -C "$tmp" && mv "$tmp/$os-$arch/helm" "$WORK/bin/helm" && chmod +x "$WORK/bin/helm"
  fi
  if [ ! -x "$WORK/bin/kubectl" ]; then
    info "downloading kubectl $KUBECTL_VERSION"
    curl -fsSL "https://dl.k8s.io/release/$KUBECTL_VERSION/bin/$os/$arch/kubectl" -o "$tmp/kubectl"
    curl -fsSL "https://dl.k8s.io/release/$KUBECTL_VERSION/bin/$os/$arch/kubectl.sha256" -o "$tmp/kubectl.sha"
    [ "$(sha256 "$tmp/kubectl")" = "$(tr -d ' \n' < "$tmp/kubectl.sha")" ] || die "kubectl checksum mismatch"
    mv "$tmp/kubectl" "$WORK/bin/kubectl" && chmod +x "$WORK/bin/kubectl"
  fi
  rm -rf "$tmp"
  ok "helm $(helm version --short 2>/dev/null), kubectl $(kubectl version --client -o json 2>/dev/null | sed -n 's/.*"gitVersion": "\(v[^"]*\)".*/\1/p' | head -1)  (in .deploy/bin)"
}

# kubeconfig with a fresh 1-hour access token; call again after long waits.
kube_auth() {
  local ep ca tok
  ep="$(gcloud container clusters describe "$CLUSTER" --region "$GCP_REGION" --project "$GCP_PROJECT" --format='value(endpoint)')"
  ca="$(gcloud container clusters describe "$CLUSTER" --region "$GCP_REGION" --project "$GCP_PROJECT" --format='value(masterAuth.clusterCaCertificate)')"
  tok="$(gcloud auth print-access-token)"
  umask 077
  cat > "$KUBECONFIG" <<EOF
apiVersion: v1
kind: Config
clusters: [{ name: gke, cluster: { server: "https://$ep", certificate-authority-data: "$ca" } }]
users: [{ name: gcloud, user: { token: "$tok" } }]
contexts: [{ name: gke, context: { cluster: gke, user: gcloud, namespace: $NAMESPACE } }]
current-context: gke
EOF
  umask 022
}

region_for_db() { # Supabase (AWS) region → nearest GCP region
  case "$1" in
    ap-south-1) echo asia-south1 ;;        ap-southeast-1) echo asia-southeast1 ;;
    ap-northeast-1) echo asia-northeast1 ;; ap-northeast-2) echo asia-northeast3 ;;
    ap-southeast-2) echo australia-southeast1 ;;
    us-east-1) echo us-east4 ;;            us-east-2) echo us-east5 ;;
    us-west-1) echo us-west2 ;;            us-west-2) echo us-west1 ;;
    ca-central-1) echo northamerica-northeast2 ;;
    eu-west-1) echo europe-west1 ;;        eu-west-2) echo europe-west2 ;;
    eu-west-3) echo europe-west9 ;;        eu-central-1) echo europe-west3 ;;
    eu-central-2) echo europe-west6 ;;     eu-north-1) echo europe-north1 ;;
    sa-east-1) echo southamerica-east1 ;;
    *) echo asia-south1 ;;
  esac
}

is_placeholder() { case "${1:-}" in ""|change-me*) return 0 ;; *) return 1 ;; esac; }

# ══════════════════════════════════════════════════════════════════════════════════════════════
step "Local tools"
command -v gcloud >/dev/null || die "gcloud not found. Install the Google Cloud CLI first."
command -v node >/dev/null && command -v npm >/dev/null || die "node/npm not found."
command -v curl >/dev/null || die "curl not found."
install_tools
[ "$TOOLS_ONLY" = "1" ] && exit 0
[ -d node_modules ] || { info "installing npm dependencies"; npm ci --silent; }
ok "node $(node -v)"

# ── .env.local ────────────────────────────────────────────────────────────────────────────────
step "Settings from .env.local"
[ -f .env.local ] || die ".env.local not found in $ROOT (copy .env.example and fill in the Supabase values)."
set -a
# shellcheck disable=SC1091
. ./.env.local || die ".env.local has a line that is not KEY=value (check for stray text)."
set +a
for k in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL; do
  is_placeholder "${!k:-}" && die "$k is empty in .env.local"
done
case "$SUPABASE_URL" in https://*.supabase.co) ;; *) warn "SUPABASE_URL does not look like https://<ref>.supabase.co" ;; esac
DB_AWS_REGION="$(printf %s "$DATABASE_URL" | sed -nE 's#.*@aws-[0-9]+-([a-z0-9-]+)\.pooler\.supabase\.com.*#\1#p')"
ok "Supabase: $(printf %s "$SUPABASE_URL" | sed -E 's#https://##')  (database region: ${DB_AWS_REGION:-unknown})"
SP="${SEED_USER_PASSWORD:-}"; [ -n "$SP" ] && [ "${#SP}" -lt 12 ] && warn "SEED_USER_PASSWORD is short (${#SP} chars). In production staff type it to sign in; consider 12+ characters."

# ── project, region, domain ───────────────────────────────────────────────────────────────────
step "GCP project"
ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
[ -n "$ACCOUNT" ] || die "Not logged in. Run: gcloud auth login"
ok "logged in as $ACCOUNT"
[ -n "$GCP_PROJECT" ] || GCP_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$GCP_PROJECT" ] || [ "$GCP_PROJECT" = "your-gcp-project-id" ] || ! gcloud projects describe "$GCP_PROJECT" >/dev/null 2>&1; then
  [ -n "$GCP_PROJECT" ] && warn "project '$GCP_PROJECT' not found or not accessible"
  echo "  Your projects:"; gcloud projects list --format='table[no-heading](projectId, name)' | sed 's/^/    /'
  GCP_PROJECT="$(ask "Project ID to deploy into:" "")"
  [ -n "$GCP_PROJECT" ] && gcloud projects describe "$GCP_PROJECT" >/dev/null 2>&1 || die "Project '$GCP_PROJECT' not accessible. Pass --project=ID."
fi
gcloud config set project "$GCP_PROJECT" >/dev/null 2>&1
PNUM="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
BILLING="$(gcloud billing projects describe "$GCP_PROJECT" --format='value(billingEnabled)' --quiet </dev/null 2>/dev/null || true)"
case "$BILLING" in
  True|true) ok "project $GCP_PROJECT (billing enabled)" ;;
  False|false) die "Billing is not enabled for $GCP_PROJECT. Link a billing account: https://console.cloud.google.com/billing/linkedaccount?project=$GCP_PROJECT" ;;
  *) warn "could not check billing for $GCP_PROJECT; continuing (GKE needs billing)" ;;
esac

[ -n "$GCP_REGION" ] || GCP_REGION="$(region_for_db "${DB_AWS_REGION:-}")"
if [ "$DOMAIN" = "__unset__" ]; then
  DOMAIN="$(ask "Domain for HTTPS (e.g. pehle.example.com). Leave empty to use http://<static IP>:" "")"
fi
DOMAIN="$(printf %s "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*##')"
case "$SECRETS_MODE" in secretmanager|k8s) ;; *) die "--secrets must be secretmanager or k8s" ;; esac
IMAGE_REPO="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$AR_REPO/pehle-aap"
GSA="$GSA_NAME@$GCP_PROJECT.iam.gserviceaccount.com"

cat <<EOF

  ${B}About to deploy (production)${N}
    project   $GCP_PROJECT
    region    $GCP_REGION   (cluster "$CLUSTER", namespace "$NAMESPACE", 2 replicas)
    address   ${DOMAIN:-http://<static IP>  (no domain → no HTTPS)}
    secrets   $SECRETS_MODE
    database  Supabase ($DB_AWS_REGION) — migrations applied if missing

  This creates billable resources: a GKE Autopilot cluster, a load balancer + static IP,
  Artifact Registry storage and Cloud Build minutes.
EOF
confirm "Continue?" || { echo "  Cancelled."; exit 0; }

# ══════════════════════════════════════════════════════════════════════════════════════════════
step "Enable Google Cloud APIs"
gcloud services enable container.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com compute.googleapis.com iamcredentials.googleapis.com monitoring.googleapis.com logging.googleapis.com --project "$GCP_PROJECT"
ok "APIs enabled"

step "Artifact Registry + Cloud Build permissions"
if gcloud artifacts repositories describe "$AR_REPO" --location "$GCP_REGION" >/dev/null 2>&1; then
  ok "repository $AR_REPO exists"
else
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location "$GCP_REGION" --quiet
  ok "repository $AR_REPO created"
fi
# New projects run Cloud Build as the Compute Engine default service account; it needs these roles.
BUILD_SA="$PNUM-compute@developer.gserviceaccount.com"
for i in 1 2 3 4 5 6; do gcloud iam service-accounts describe "$BUILD_SA" >/dev/null 2>&1 && break; info "waiting for $BUILD_SA to exist"; sleep 10; done
for role in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member "serviceAccount:$BUILD_SA" --role "$role" --condition=None --quiet >/dev/null
done
ok "Cloud Build can push images"

step "GKE Autopilot cluster"
if gcloud container clusters describe "$CLUSTER" --region "$GCP_REGION" >/dev/null 2>&1; then
  ok "cluster $CLUSTER exists"
else
  info "creating cluster $CLUSTER in $GCP_REGION — this takes about 10 minutes"
  gcloud container clusters create-auto "$CLUSTER" --region "$GCP_REGION" --quiet
  ok "cluster created"
fi
kube_auth
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE" >/dev/null
ok "kubectl connected; namespace $NAMESPACE ready"

step "Static IP"
gcloud compute addresses describe "$IP_NAME" --global >/dev/null 2>&1 || gcloud compute addresses create "$IP_NAME" --global --quiet
IP="$(gcloud compute addresses describe "$IP_NAME" --global --format='value(address)')"
ok "static IP $IP"
if [ -n "$DOMAIN" ]; then
  APP_URL_PROD="https://$DOMAIN"
  RESOLVED="$(dig +short "$DOMAIN" A 2>/dev/null | tail -1 || true)"
  if [ "$RESOLVED" = "$IP" ]; then ok "DNS: $DOMAIN → $IP"
  else warn "DNS: create an A record  $DOMAIN → $IP  (currently: ${RESOLVED:-none}). HTTPS starts working 15–60 min after it resolves."; fi
else
  APP_URL_PROD="http://$IP"
fi

# ── secrets ───────────────────────────────────────────────────────────────────────────────────
step "Secrets ($SECRETS_MODE)"
# ENV_NAME:secret-name:kind   (required | generate | optional)
SECRET_SPECS="SUPABASE_URL:pehle-supabase-url:required
SUPABASE_ANON_KEY:pehle-supabase-anon-key:required
SUPABASE_SERVICE_ROLE_KEY:pehle-supabase-service-role-key:required
CLOCK_HMAC_SECRET:pehle-clock-hmac-secret:generate
GUEST_COOKIE_SECRET:pehle-guest-cookie-secret:generate
METRICS_TOKEN:pehle-metrics-token:generate
JOBS_TOKEN:pehle-jobs-token:generate
NUDGEBEE_WEBHOOK_SECRET:pehle-nudgebee-webhook-secret:generate
SEED_USER_PASSWORD:pehle-seed-user-password:optional
SARVAM_API_KEY:pehle-sarvam-api-key:optional
FLAGSMITH_SERVER_KEY:pehle-flagsmith-server-key:optional
FLAGSMITH_ADMIN_KEY:pehle-flagsmith-admin-key:optional
FLAGSMITH_ENVIRONMENT_KEY:pehle-flagsmith-environment-key:optional
ANTHROPIC_API_KEY:pehle-anthropic-api-key:optional
DATABASE_URL:pehle-database-url:migrate"

existing_value() { # $1 env name, $2 secret name
  if [ "$SECRETS_MODE" = "secretmanager" ]; then
    gcloud secrets versions access latest --secret="$SECRET_PREFIX$2" 2>/dev/null </dev/null || true
  else
    kubectl get secret pehle-aap-secrets -n "$NAMESPACE" -o "jsonpath={.data.$1}" 2>/dev/null </dev/null | base64 --decode 2>/dev/null || true
  fi
}

HELM_SECRET_ARGS=()
SECRETS_CHANGED=0
K8S_ENV_FILE="$WORK/k8s-secrets.env"; : > "$K8S_ENV_FILE"; chmod 600 "$K8S_ENV_FILE"
if [ "$SECRETS_MODE" = "secretmanager" ]; then
  gcloud iam service-accounts describe "$GSA" >/dev/null 2>&1 || gcloud iam service-accounts create "$GSA_NAME" --display-name "Pehle Aap prod (reads secrets)" --quiet
fi
OLDIFS="$IFS"; IFS=$'\n'
for spec in $SECRET_SPECS; do
  IFS="$OLDIFS"
  envk="${spec%%:*}"; rest="${spec#*:}"; sname="${rest%%:*}"; kind="${rest#*:}"
  val="${!envk:-}"
  src=".env.local"
  if is_placeholder "$val"; then
    case "$kind" in
      required|migrate) die "$envk is required" ;;
      generate) val="$(existing_value "$envk" "$sname")"; src="kept"; [ -n "$val" ] || { val="$(openssl rand -hex 32)"; src="generated"; } ;;
      optional) val="" ;;
    esac
  fi
  if [ -z "$val" ]; then
    info "$envk: not set (that integration stays off)"
    HELM_SECRET_ARGS+=(--set "externalSecrets.keys.$envk=null")
    IFS=$'\n'; continue
  fi
  # migrate-kind secrets (DATABASE_URL) are not in the app's key list at all — nothing to remove.
  if [ "$SECRETS_MODE" = "secretmanager" ]; then
    full="$SECRET_PREFIX$sname"
    if ! gcloud secrets describe "$full" >/dev/null 2>&1 </dev/null; then
      printf %s "$val" | gcloud secrets create "$full" --replication-policy=automatic --data-file=- --quiet >/dev/null
      SECRETS_CHANGED=1
      ok "$envk → Secret Manager $full (created, $src)"
    elif [ "$(existing_value "$envk" "$sname")" != "$val" ]; then
      printf %s "$val" | gcloud secrets versions add "$full" --data-file=- --quiet >/dev/null
      SECRETS_CHANGED=1
      ok "$envk → Secret Manager $full (new version)"
    else
      ok "$envk → Secret Manager $full (unchanged)"
    fi
  else
    [ "$(existing_value "$envk" "$sname")" = "$val" ] || SECRETS_CHANGED=1
    printf '%s=%s\n' "$envk" "$val" >> "$K8S_ENV_FILE"
    ok "$envk ($src)"
  fi
  IFS=$'\n'
done
IFS="$OLDIFS"

if [ "$SECRETS_MODE" = "secretmanager" ]; then
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member "serviceAccount:$GSA" --role roles/secretmanager.secretAccessor --condition=None --quiet >/dev/null
  gcloud iam service-accounts add-iam-policy-binding "$GSA" --role roles/iam.workloadIdentityUser \
    --member "serviceAccount:$GCP_PROJECT.svc.id.goog[$NAMESPACE/pehle-aap]" --condition=None --quiet >/dev/null
  ok "Workload Identity: $NAMESPACE/pehle-aap → $GSA (secretAccessor)"
  if helm status external-secrets -n external-secrets >/dev/null 2>&1; then
    ok "External Secrets Operator installed"
  else
    info "installing External Secrets Operator (a few minutes on Autopilot)"
    helm upgrade --install external-secrets external-secrets --repo https://charts.external-secrets.io \
      -n external-secrets --create-namespace --wait --timeout 15m >/dev/null
    ok "External Secrets Operator installed"
  fi
else
  kubectl create secret generic pehle-aap-secrets -n "$NAMESPACE" --from-env-file="$K8S_ENV_FILE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  ok "Kubernetes secret pehle-aap-secrets written"
fi
rm -f "$K8S_ENV_FILE"

# ── database ──────────────────────────────────────────────────────────────────────────────────
step "Database (Supabase)"
pg_count() { # pg_count "<sql returning one int column n>"
  Q="$1" node --input-type=module -e '
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try { const [r] = await s.unsafe(process.env.Q); console.log(r.n); } catch { console.log("?"); } finally { await s.end(); }'
}

# 1. Backup first (custom format; restore with pg_restore). Kept outside the repo: it holds phones and ledger data.
if [ "$SKIP_BACKUP" = "1" ]; then
  warn "backup skipped (--skip-backup)"
else
  PG_DUMP="$(command -v pg_dump || true)"
  [ -n "$PG_DUMP" ] || PG_DUMP="$(ls -d /Applications/Postgres.app/Contents/Versions/latest/bin/pg_dump 2>/dev/null || true)"
  [ -n "$PG_DUMP" ] || die "pg_dump not found. Install the PostgreSQL client tools (or Postgres.app), or re-run with --skip-backup."
  mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/pehle-$GCP_PROJECT-$(date +%Y%m%d-%H%M%S).dump"
  info "backing up the database with $($PG_DUMP --version | awk '{print $NF}')"
  "$PG_DUMP" "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$BACKUP_FILE" || die "Backup failed — nothing was changed. Fix the error above, or re-run with --skip-backup."
  chmod 600 "$BACKUP_FILE"
  ok "backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))  — restore: pg_restore --clean --no-owner -d \"\$DATABASE_URL\" \"$BACKUP_FILE\""
fi

# 2. Migrations. First install: here. Upgrades: the Helm pre-upgrade hook Job, right before new pods
#    start, so the running version is not left on a newer schema longer than necessary.
if helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
  ok "migrations will run in the pre-upgrade hook Job just before the new pods start"
else
  npm run -s migrate
fi

WEDDINGS="$(pg_count "select count(*)::int n from wedding")"
if [ "$WEDDINGS" = "0" ]; then
  if [ -z "${SEED_USER_PASSWORD:-}" ]; then
    warn "no wedding yet and SEED_USER_PASSWORD is empty — skipping demo seed"
  elif confirm "No wedding in the database. Seed the demo wedding (40 synthetic families, one login per role)?"; then
    APP_ENV=production APP_URL="$APP_URL_PROD" npx tsx scripts/seed.ts --allow-production > "$WORK/seed-output.txt"
    chmod 600 "$WORK/seed-output.txt"
    ok "demo wedding seeded — logins, family codes and links saved to .deploy/seed-output.txt"
  fi
else
  ok "$WEDDINGS wedding(s) already present — not seeding"
fi

# ── image ─────────────────────────────────────────────────────────────────────────────────────
step "Container image (Cloud Build)"
if [ "$SKIP_BUILD" = "1" ] && [ -f "$WORK/last-tag" ]; then
  TAG="$(cat "$WORK/last-tag")"; ok "reusing $TAG"
else
  SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
  git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null || SHA="$SHA-dirty"
  TAG="$SHA-$(date +%Y%m%d-%H%M%S)"
  cat > "$WORK/cloudbuild.yaml" <<'EOF'
steps:
  - name: gcr.io/cloud-builders/docker
    args: ["build", "--build-arg", "GIT_SHA=$_TAG", "-t", "$_IMAGE:$_TAG", "."]
images: ["$_IMAGE:$_TAG"]
timeout: 1800s
options: { machineType: E2_HIGHCPU_8, logging: CLOUD_LOGGING_ONLY }
EOF
  info "building $IMAGE_REPO:$TAG (about 5 minutes; source upload excludes secrets via .gcloudignore)"
  gcloud builds submit . --config "$WORK/cloudbuild.yaml" --substitutions "_IMAGE=$IMAGE_REPO,_TAG=$TAG" --quiet
  echo "$TAG" > "$WORK/last-tag"
  ok "image $TAG pushed"
fi

# ── deploy ────────────────────────────────────────────────────────────────────────────────────
step "Deploy to GKE (helm)"
kube_auth
TLS=false; [ -n "$DOMAIN" ] && TLS=true
ESO=true; [ "$SECRETS_MODE" = "k8s" ] && ESO=false
helm upgrade --install "$RELEASE" "$CHART" -n "$NAMESPACE" -f "$CHART/values-prod.yaml" \
  --set image.repository="$IMAGE_REPO" --set image.tag="$TAG" \
  --set appEnv=production --set appUrl="$APP_URL_PROD" --set replicaCount=2 \
  --set ingress.host="$DOMAIN" --set ingress.managedCertificate="$TLS" --set ingress.staticIpName="$IP_NAME" \
  --set serviceAccount.gcpServiceAccount="$([ "$ESO" = true ] && echo "$GSA")" \
  --set externalSecrets.enabled="$ESO" --set externalSecrets.projectId="$GCP_PROJECT" --set externalSecrets.prefix="$SECRET_PREFIX" \
  --set gke.clusterName="$CLUSTER" --set gke.location="$GCP_REGION" \
  --set externalSecrets.migrateKey=pehle-database-url --set jobsCron.enabled="$JOBS_CRON" \
  --timeout 15m \
  ${HELM_SECRET_ARGS[@]+"${HELM_SECRET_ARGS[@]}"} >/dev/null   # pre-upgrade hook Job runs migrations first
ok "release $RELEASE upgraded (revision $(helm history "$RELEASE" -n "$NAMESPACE" --max 1 -o json | sed -nE 's/.*"revision":([0-9]+).*/\1/p'))"

if [ "$ESO" = true ]; then
  info "waiting for secrets to sync from Secret Manager"
  if ! kubectl wait --for=condition=Ready externalsecret/pehle-aap-secrets -n "$NAMESPACE" --timeout=300s >/dev/null 2>&1; then
    kubectl annotate externalsecret pehle-aap-secrets -n "$NAMESPACE" force-sync="$(date +%s)" --overwrite >/dev/null 2>&1 || true
    kubectl wait --for=condition=Ready externalsecret/pehle-aap-secrets -n "$NAMESPACE" --timeout=180s >/dev/null 2>&1 || {
      kubectl describe externalsecret pehle-aap-secrets -n "$NAMESPACE" | tail -15
      die "Secrets did not sync (often IAM propagation; wait 2 minutes and re-run). Or re-run with --secrets=k8s."
    }
  fi
  ok "secrets synced"
  if [ "$SECRETS_CHANGED" = "1" ]; then
    # Pull the new Secret Manager versions now instead of at the hourly refresh.
    BEFORE="$(kubectl get externalsecret pehle-aap-secrets -n "$NAMESPACE" -o jsonpath='{.status.refreshTime}' 2>/dev/null || true)"
    kubectl annotate externalsecret pehle-aap-secrets -n "$NAMESPACE" force-sync="$(date +%s)" --overwrite >/dev/null
    for i in $(seq 1 24); do
      [ "$(kubectl get externalsecret pehle-aap-secrets -n "$NAMESPACE" -o jsonpath='{.status.refreshTime}' 2>/dev/null || true)" != "$BEFORE" ] && break
      sleep 5
    done
    ok "new secret values pulled from Secret Manager"
  fi
fi

if [ "$SECRETS_CHANGED" = "1" ] && kubectl get deployment pehle-aap -n "$NAMESPACE" >/dev/null 2>&1; then
  kubectl rollout restart deployment/pehle-aap -n "$NAMESPACE" >/dev/null   # pods read secrets only at start
  ok "pods restarting to pick up changed secrets"
fi

info "waiting for pods (Autopilot may add nodes first: up to ~10 minutes)"
if ! kubectl rollout status deployment/pehle-aap -n "$NAMESPACE" --timeout=15m; then
  kubectl get pods -n "$NAMESPACE" -o wide || true
  kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp | tail -15 || true
  kubectl logs deployment/pehle-aap -n "$NAMESPACE" --tail=40 2>/dev/null || true
  die "Pods did not become ready. To undo: $WORK/bin/helm rollback $RELEASE -n $NAMESPACE"
fi
ok "2 pods running"

step "Load balancer + health check"
info "first deploy: Google's load balancer takes 5–15 minutes to come up"
HEALTH=""
for i in $(seq 1 100); do
  HEALTH="$(curl -fsS --max-time 5 "http://$IP/api/health" 2>/dev/null || true)"
  case "$HEALTH" in *"\"sha\":\"$TAG\""*) break ;; esac
  [ $((i % 4)) -eq 0 ] && info "still waiting… ($((i * 15 / 60)) min)"
  sleep 15
done
case "$HEALTH" in
  *"\"sha\":\"$TAG\""*) ok "http://$IP/api/health → $HEALTH" ;;
  *) warn "health check not passing yet (load balancer may still be provisioning). Check later: curl http://$IP/api/health" ;;
esac
step "Super admin"
if [ -n "$SUPER_ADMIN_EMAIL" ]; then
  node scripts/grant-super-admin.mjs "$SUPER_ADMIN_EMAIL" || die "Could not make $SUPER_ADMIN_EMAIL a super admin (see above)."
  ok "$SUPER_ADMIN_EMAIL is a super admin"
fi
SUPERS="$(pg_count "select authz.active_super_admins() n")"
case "$SUPERS" in
  0) warn "no super admin yet — nobody can create weddings or edit roles. Re-run with --super-admin=you@example.com --skip-build" ;;
  "?") warn "could not check super admins" ;;
  *) ok "$SUPERS active super admin(s)" ;;
esac

UPTIME_HOST="${DOMAIN:-$IP}"; UPTIME_PROTO="$([ -n "$DOMAIN" ] && [ "${CERT_READY:-}" = 1 ] && echo https || echo http)"
if gcloud monitoring uptime list-configs --project "$GCP_PROJECT" --filter='displayName="pehle-aap-health"' --format='value(name)' 2>/dev/null </dev/null | grep -q .; then
  ok "Cloud Monitoring uptime check exists (pehle-aap-health)"
elif gcloud monitoring uptime create pehle-aap-health --project "$GCP_PROJECT" --resource-type=uptime-url \
      --resource-labels="host=$UPTIME_HOST,project_id=$GCP_PROJECT" --path=/api/health --protocol="$UPTIME_PROTO" \
      --period=1 --timeout=10 --quiet >/dev/null 2>&1 </dev/null; then
  ok "Cloud Monitoring uptime check created: $UPTIME_PROTO://$UPTIME_HOST/api/health every minute"
else
  warn "could not create the uptime check; create it in Cloud Monitoring → Uptime checks for /api/health"
fi
CERT=""
if [ -n "$DOMAIN" ]; then
  CERT="$(kubectl get managedcertificate pehle-aap-cert -n "$NAMESPACE" -o jsonpath='{.status.certificateStatus}' 2>/dev/null || true)"
  [ "$CERT" = "Active" ] && ok "HTTPS certificate active" || warn "HTTPS certificate: ${CERT:-Provisioning} (needs the DNS A record; 15–60 min)"
fi

# ══════════════════════════════════════════════════════════════════════════════════════════════
cat <<EOF

${G}${B}Deployed.${N}

  App              $APP_URL_PROD
  Staff sign-in    $APP_URL_PROD/login   (email per role, password = SEED_USER_PASSWORD; no quick-login in production)
  Guest check-in   $APP_URL_PROD/checkin?event=<event id>
  Seed output      ${WORK#$ROOT/}/seed-output.txt  (logins, family codes, TV links — keep private)
$( [ -n "$DOMAIN" ] && [ "$CERT" != "Active" ] && printf '  Until HTTPS is active, use http://%s\n' "$IP" )

  Useful commands (from the project folder):
    export PATH="\$PWD/.deploy/bin:\$PATH" KUBECONFIG="\$PWD/.deploy/kubeconfig"   # then re-run deploy to refresh the token
    kubectl get pods -n $NAMESPACE
    kubectl logs deployment/pehle-aap -n $NAMESPACE --tail=100
    helm rollback $RELEASE -n $NAMESPACE              # undo the last deploy
$( [ "$SECRETS_MODE" = "secretmanager" ] && printf '    gcloud secrets versions access latest --secret=%spehle-metrics-token      # values for Prometheus / NudgeBee\n' "$SECRET_PREFIX" )

  Re-run this script any time to deploy new code; finished steps are skipped.
EOF
