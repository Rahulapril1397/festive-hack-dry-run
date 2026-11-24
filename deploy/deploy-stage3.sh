#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────
# Minimal-demo release of Pehle Aap on GCP, on top of a running Stage 2 (production only).
#
#   bash deploy/deploy-stage3.sh
#   bash deploy/deploy-stage3.sh --domain=pehle-aap.endpoints.<project>.cloud.goog --yes
#
# Order of work:
#   1. Pre-flight: tools, gcloud login, .env.local keys, and the Helm revision that is live now
#      (printed again at the end as the rollback target).
#   2. deploy/gcp-deploy.sh --no-jobs: backs up the database (pg_dump → ~/pehle-backups), builds the
#      image with Cloud Build, applies the pending migrations (additive: new tables and columns) in a
#      Helm pre-upgrade Job, and rolls out. The background-jobs scheduler is left off: the demo's
#      tasks are static, so nothing needs it.
#   3. Verifies the live app (health, guest link, protected APIs, demo tile requires sign-in).
#   4. Prints the manual smoke checklist and the rollback command.
#
# https: run deploy/setup-https-endpoints.sh first and pass its hostname with --domain.
# Safe to re-run. Rollback: helm rollback (printed at the end). The database changes only add
# tables and columns, so the previous code keeps working after a rollback.
# ──────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
WORK="$ROOT/.deploy"; mkdir -p "$WORK"
export PATH="$WORK/bin:$PATH" KUBECONFIG="$WORK/kubeconfig"

PROJECT=""; DOMAIN=""; YES=0; EXTRA=()
for a in "$@"; do
  case "$a" in
    --project=*) PROJECT="${a#*=}" ;;
    --domain=*) DOMAIN="${a#*=}" ;;
    --skip-build|--skip-backup) EXTRA+=("$a") ;;
    -y|--yes) YES=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

say "1. Pre-flight"
command -v gcloud >/dev/null || fail "gcloud is not installed"
[ -f .env.local ] || fail ".env.local is missing (Supabase, Sarvam and Flagsmith keys)"
for k in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SARVAM_API_KEY FLAGSMITH_SERVER_KEY DATABASE_URL; do
  grep -Eq "^$k=.+" .env.local || fail "$k is empty in .env.local"
done
[ -n "$PROJECT" ] || PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
[ -n "$PROJECT" ] || fail "no GCP project (pass --project=ID)"
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . || fail "run: gcloud auth login"
git diff --quiet && git diff --cached --quiet || echo "Note: the working tree has uncommitted changes; the image is built from what is on disk."

IP="$(gcloud compute addresses describe pehle-aap-prod-ip --global --project "$PROJECT" --format='value(address)' 2>/dev/null || true)"
if [ -n "$DOMAIN" ]; then APP="https://$DOMAIN"; else APP="http://${IP:?static IP pehle-aap-prod-ip not found}"; fi
echo "Project: $PROJECT   Live address after deploy: $APP"
LIVE="$(curl -fsS --max-time 10 "http://$IP/api/health" 2>/dev/null || echo 'not reachable')"
echo "Live now: $LIVE"
if [ -x "$WORK/bin/helm" ] && [ -f "$KUBECONFIG" ]; then
  PREV_REV="$(helm history pehle-aap -n prod --max 1 -o json 2>/dev/null | sed -n 's/.*"revision":\([0-9]*\).*/\1/p' | head -1 || true)"
fi
echo "Helm revision live now (rollback target): ${PREV_REV:-unknown}"

if [ "$YES" != 1 ]; then
  printf '\nThis backs up the database, applies pending migrations and replaces the running app. Continue? [yes/no] '
  read -r ans; [ "$ans" = yes ] || fail "cancelled"
fi

say "2. Deploy (deploy/gcp-deploy.sh)"
ARGS=(--yes --no-jobs --project="$PROJECT")
[ -n "$DOMAIN" ] && ARGS+=(--domain="$DOMAIN")
bash deploy/gcp-deploy.sh "${ARGS[@]}" "${EXTRA[@]+"${EXTRA[@]}"}"

say "3. Verify $APP"
ok=0; bad=0
check() { # name expected-codes url [method]
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X "${4:-GET}" "$3" || echo 000)"
  if [[ " $2 " == *" $code "* ]]; then printf '  ok    %-34s %s\n' "$1" "$code"; ok=$((ok+1)); else printf '  FAIL  %-34s got %s, wanted %s\n' "$1" "$code" "$2"; bad=$((bad+1)); fi
}
for i in $(seq 1 12); do curl -fsS --max-time 10 "$APP/api/health" >/dev/null 2>&1 && break; sleep 10; done
check "health"                         "200"         "$APP/api/health"
check "invalid family link page"       "200 404"     "$APP/f/not-a-real-key-123"
check "admin API needs sign-in"        "401 403"     "$APP/api/admin/users"
check "PinkyBua voice needs a caller"  "401 403"     "$APP/api/assistant/voice?mode=staff"
check "demo tile needs sign-in"        "302 307 308" "$APP/demo/vendors"
check "jobs tick needs its token"      "403 411"     "$APP/api/jobs/tick" POST
echo "$ok passed, $bad failed"

say "4. Manual smoke (details: the plan's acceptance checklist)"
cat <<TXT
  - Sign in as admin, host, finance, photographer, vendor, helper: each menu matches the roles table.
  - Open Vendors, Event readiness, Tasks, Gift ledger: Preview label; Add says "Demo only".
  - Open a family link: language screen first; Group A sees English + Hindi, group B also a dropdown.
  - Photographer uploads the demo batch; review shows Check this / Unmatched; confirm one; open that family's album.
  - PinkyBua (admin): photo question by voice. Needs https or localhost for the microphone.
  - Flagsmith: create 'sarvam_force_fail' (OFF) and 'pinkybua_languages' (50) if not there yet.
  - If you used --domain: node scripts/set-auth-urls.mjs $APP
Rollback:  helm rollback pehle-aap ${PREV_REV:-<revision>} -n prod
TXT
[ "$bad" = 0 ] || exit 1
