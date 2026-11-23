#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────
# Stage 2 upgrade of Pehle Aap on GCP, on top of a running Stage 1 (production only).
#
#   bash deploy/deploy-stage2.sh
#   bash deploy/deploy-stage2.sh --project=festive-hack-dry-run --super-admin=admin@demo.pehleaap.test
#
# What it does, in order:
#   1. Checks: tools, gcloud login, project, .env.local (Supabase, Sarvam, Flagsmith keys), and
#      that this checkout contains Stage 2.
#   2. Shows what is live now (version, migrations, Helm revision) — needed for rollback.
#   3. Runs deploy/gcp-deploy.sh, which: backs up the database (pg_dump → ~/pehle-backups),
#      builds the image (Cloud Build), runs the Stage 2 migrations in a Helm pre-upgrade Job right
#      before the new pods start, rolls out 2 pods, and makes the chosen user a super admin.
#   4. Verifies the live app: new version, migrations applied, secrets synced, pods ready,
#      admin/assistant endpoints protected, guest/TV pages up, at least one super admin.
#   5. Prints the links, the manual smoke checklist and the exact rollback command.
#
# Safe to re-run. During the switch (1–3 minutes) staff sign-in can fail; guests and the TV keep
# working. Rollback: bash deploy/rollback-stage2.sh (printed at the end with the right values).
# ──────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
WORK="$ROOT/.deploy"
mkdir -p "$WORK"
export PATH="$WORK/bin:$PATH" KUBECONFIG="$WORK/kubeconfig"

PROJECT=""; SUPER_ADMIN=""; EXTRA=()
for a in "$@"; do
  case "$a" in
    --project=*) PROJECT="${a#*=}" ;;
    --super-admin=*) SUPER_ADMIN="${a#*=}" ;;
    --skip-build|--skip-backup) EXTRA+=("$a") ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 2 ;;
  esac
done

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=; G=; Y=; R=; N=; fi
STEP=0
step() { STEP=$((STEP + 1)); printf "\n${B}== %d. %s${N}\n" "$STEP" "$*"; }
ok()   { printf "  ${G}✓${N} %s\n" "$*"; }
warn() { printf "  ${Y}!${N} %s\n" "$*"; }
fail() { printf "  ${R}✗${N} %s\n" "$*"; FAILED=$((FAILED + 1)); }
die()  { printf "\n${R}✗ %s${N}\n" "$*" >&2; exit 1; }
ask()  { # prompt on the terminal; without one (CI), fall back to the default answer
  local a=""
  if { exec 3</dev/tty; } 2>/dev/null; then read -r -p "  ? $1 " a <&3 || true; exec 3<&-; fi
  echo "${a:-${2:-}}"
}
FAILED=0

db_value() { # db_value "<sql returning one column v>"  → value or "?"
  Q="$1" node --input-type=module -e '
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try { const [r] = await s.unsafe(process.env.Q); console.log(r?.v ?? ""); } catch { console.log("?"); } finally { await s.end(); }'
}

# ══════════════════════════════════════════════════════════════════════════════════════════════
step "Pre-flight checks"
command -v gcloud >/dev/null || die "gcloud not found"
command -v node >/dev/null || die "node not found"
command -v curl >/dev/null || die "curl not found"
[ -f supabase/migrations/0010_rbac.sql ] && [ -f src/lib/assistant/provider.ts ] || die "This checkout does not contain Stage 2 (git pull / checkout main)."
ok "Stage 2 code present ($(git rev-parse --short HEAD 2>/dev/null || echo no-git))"
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  warn "you have uncommitted changes; they will be deployed too (image tag gets a -dirty suffix)"
fi
[ -d node_modules ] || { echo "  installing npm dependencies…"; npm ci --silent; }

[ -f .env.local ] || die ".env.local not found"
set -a
# shellcheck disable=SC1091
. ./.env.local || die ".env.local has a line that is not KEY=value"
set +a
missing=()
for k in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL SARVAM_API_KEY FLAGSMITH_SERVER_KEY FLAGSMITH_ADMIN_KEY FLAGSMITH_ENVIRONMENT_KEY; do
  v="${!k:-}"
  case "$v" in ""|change-me*) missing+=("$k") ;; esac
done
[ ${#missing[@]} -eq 0 ] || die "Missing in .env.local (Stage 2 runs everything live): ${missing[*]}"
ok ".env.local: Supabase, Sarvam (translation, speech, PinkyBua) and Flagsmith keys present"
case "$SARVAM_API_KEY" in *" "*) die "SARVAM_API_KEY contains a space — keep only the sk_… key" ;; esac
case "$FLAGSMITH_SERVER_KEY" in ser.*) ;; *) die "FLAGSMITH_SERVER_KEY must be the server-side key (starts with ser.)" ;; esac
[ "$FLAGSMITH_ADMIN_KEY" != "$FLAGSMITH_ENVIRONMENT_KEY" ] || die "FLAGSMITH_ENVIRONMENT_KEY equals FLAGSMITH_ADMIN_KEY — use the environment's client-side key"

gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . || die "Not logged in: run gcloud auth login"
[ -n "$PROJECT" ] || PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "your-gcp-project-id" ] || ! gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  PROJECT="$(ask "GCP project id (Stage 1 runs in festive-hack-dry-run) [festive-hack-dry-run]:" festive-hack-dry-run)"
fi
gcloud projects describe "$PROJECT" >/dev/null 2>&1 || die "Project $PROJECT not accessible"
ok "project $PROJECT"

IP="$(gcloud compute addresses describe pehle-aap-prod-ip --global --project "$PROJECT" --format='value(address)' 2>/dev/null || true)"
[ -n "$IP" ] || die "No Stage 1 deployment found in $PROJECT (static IP pehle-aap-prod-ip missing). Run deploy/gcp-deploy.sh for a first install."
URL="http://$IP"
ok "app address $URL (static IP)"

# ══════════════════════════════════════════════════════════════════════════════════════════════
step "What is live now"
LIVE="$(curl -fsS --max-time 10 "$URL/api/health" 2>/dev/null || echo '')"
LIVE_SHA="$(printf %s "$LIVE" | sed -nE 's/.*"sha":"([^"]+)".*/\1/p')"
[ -n "$LIVE_SHA" ] && ok "running version $LIVE_SHA" || warn "health check did not answer ($URL/api/health)"
MIGS="$(db_value "select string_agg(name, ' ' order by name) v from pehle_meta.migration")"
ok "database migrations: ${MIGS:-none}"
case " $MIGS " in *" 0010_rbac.sql "*) STAGE2_DB=1; warn "Stage 2 migrations are already applied — this run updates Stage 2" ;; *) STAGE2_DB=0 ;; esac
REGION="$(gcloud container clusters list --project "$PROJECT" --filter=name=pehle-aap --format='value(location)' 2>/dev/null | head -1)"
kube_auth() { # short-lived token kubeconfig (no gke-gcloud-auth-plugin needed)
  local ep ca tok
  ep="$(gcloud container clusters describe pehle-aap --region "$REGION" --project "$PROJECT" --format='value(endpoint)')" || return 1
  ca="$(gcloud container clusters describe pehle-aap --region "$REGION" --project "$PROJECT" --format='value(masterAuth.clusterCaCertificate)')"
  tok="$(gcloud auth print-access-token)"
  ( umask 077; printf 'apiVersion: v1\nkind: Config\nclusters: [{ name: gke, cluster: { server: "https://%s", certificate-authority-data: "%s" } }]\nusers: [{ name: gcloud, user: { token: "%s" } }]\ncontexts: [{ name: gke, context: { cluster: gke, user: gcloud, namespace: prod } }]\ncurrent-context: gke\n' "$ep" "$ca" "$tok" > "$KUBECONFIG" )
}
PREV_REV=""
if [ -n "$REGION" ] && command -v helm >/dev/null 2>&1 && kube_auth 2>/dev/null; then
  PREV_REV="$(helm history pehle-aap -n prod --max 1 -o json 2>/dev/null | sed -nE 's/.*"revision":([0-9]+).*/\1/p' || true)"
fi
[ -n "$PREV_REV" ] && ok "current Helm revision $PREV_REV (rollback target)" || warn "Helm revision not read yet (gcp-deploy.sh installs helm/kubectl); the rollback script finds it itself"

# ══════════════════════════════════════════════════════════════════════════════════════════════
step "Choices"
if [ -z "$SUPER_ADMIN" ]; then
  echo "  A super admin can create weddings and edit roles. Stage 1 has none."
  SUPER_ADMIN="$(ask "Email of an existing staff user to make super admin [admin@demo.pehleaap.test]:" admin@demo.pehleaap.test)"
fi
SUPER_ADMIN="$(printf %s "$SUPER_ADMIN" | tr 'A-Z' 'a-z')"
EXISTS="$(db_value "select count(*)::text v from app_user where lower(email) = '$(printf %s "$SUPER_ADMIN" | sed "s/'/''/g")'")"
[ "$EXISTS" = "1" ] || die "$SUPER_ADMIN is not a staff user in this database. Use an existing login (e.g. admin@demo.pehleaap.test)."
ok "super admin will be: $SUPER_ADMIN"

cat <<EOF

  ${B}Supabase setting needed for inviting new staff (one-time, in the dashboard):${N}
    Authentication → URL Configuration
      Site URL:       $URL
      Redirect URLs:  $URL/login/accept
  Existing logins work without it.
EOF
A="$(ask "Done, or skip for now? [done/skip]:" skip)"
[ "$A" = "done" ] && ok "invite links will land on $URL/login/accept" || warn "skipped — invites will fail until it is set"

cat <<EOF

  ${B}About to upgrade production to Stage 2${N}
    project    $PROJECT        address  $URL
    backup     pg_dump → ~/pehle-backups (before anything changes)
    database   migrations 0010, 0011, 0110, 0204 (roles move to Postgres; "stage" → "stage_manager")
    app        new image, 2 pods, PinkyBua on Sarvam, live Sarvam + Flagsmith
    downtime   staff sign-in may fail for 1–3 minutes during the switch; guests and TV keep working
EOF
A="$(ask "Continue? [y/N]:" n)"
case "$A" in y|Y|yes|YES) ;; *) echo "  Cancelled. Nothing changed."; exit 0 ;; esac

# ══════════════════════════════════════════════════════════════════════════════════════════════
step "Deploy (backup → image → migrations → rollout → super admin)"
set +e
/bin/bash deploy/gcp-deploy.sh --project="$PROJECT" --domain= --super-admin="$SUPER_ADMIN" --yes ${EXTRA[@]+"${EXTRA[@]}"} 2>&1 | tee "$WORK/stage2-deploy.log"
DEPLOY_RC="${PIPESTATUS[0]}"
set -e
[ "$DEPLOY_RC" = "0" ] || die "Deploy failed (log: .deploy/stage2-deploy.log). If the new version is half-live, run: bash deploy/rollback-stage2.sh"
BACKUP_FILE="$(sed -nE 's/.*backup: ([^ ]+\.dump).*/\1/p' "$WORK/stage2-deploy.log" | tail -1)"
NEW_TAG="$(cat "$WORK/last-tag" 2>/dev/null || echo "")"

# ══════════════════════════════════════════════════════════════════════════════════════════════
step "Verify the live app"
H="$(curl -fsS --max-time 10 "$URL/api/health" || echo '')"
case "$H" in *"\"sha\":\"$NEW_TAG\""*) ok "serving the new version $NEW_TAG" ;; *) fail "health shows ${H:-no answer}, expected $NEW_TAG" ;; esac

MIGS="$(db_value "select string_agg(name, ' ' order by name) v from pehle_meta.migration")"
for m in 0010_rbac.sql 0011_admin.sql 0110_assistant.sql 0204_live.sql; do
  case " $MIGS " in *" $m "*) ok "migration $m applied" ;; *) fail "migration $m missing" ;; esac
done

if kubectl get externalsecret pehle-aap-secrets -n prod -o jsonpath='{.status.conditions[0].status}' 2>/dev/null | grep -q True; then ok "secrets synced from Secret Manager"; else fail "secrets not synced (kubectl describe externalsecret pehle-aap-secrets -n prod)"; fi
READY="$(kubectl get deploy pehle-aap -n prod -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)"
[ "${READY:-0}" -ge 2 ] && ok "$READY pods ready" || fail "only ${READY:-0} pods ready"
PROVIDER="$(kubectl get deploy pehle-aap -n prod -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="ASSISTANT_PROVIDER")].value}' 2>/dev/null || true)"
[ "$PROVIDER" = "sarvam" ] && ok "PinkyBua provider: Sarvam" || fail "ASSISTANT_PROVIDER is '${PROVIDER:-unset}'"

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
[ "$(code "$URL/login")" = "200" ] && ok "/login 200" || fail "/login not 200"
[ "$(code "$URL/api/admin/users")" = "401" ] && ok "admin API refuses anonymous callers (401)" || fail "/api/admin/users should be 401"
[ "$(code -X POST -H 'content-type: application/json' -d '{"mode":"guest","text":"hi"}' "$URL/api/assistant/message")" = "401" ] && ok "PinkyBua refuses callers without a session or family link (401)" || fail "/api/assistant/message should be 401 without a session"
[ "$(code "$URL/api/ledger")" = "401" ] && ok "ledger API refuses anonymous callers (401)" || fail "/api/ledger should be 401"
TVKEY="$(db_value "select tv_key v from event order by starts_at nulls last limit 1")"
TVEVENT="$(db_value "select id::text v from event order by starts_at nulls last limit 1")"
[ -n "$TVEVENT" ] && [ "$TVEVENT" != "?" ] && { [ "$(code "$URL/tv/$TVEVENT?key=$TVKEY")" = "200" ] && ok "TV page 200" || fail "TV page not 200"; }
LINK="$(db_value "select link_key v from family order by created_at limit 1")"
[ -n "$LINK" ] && [ "$LINK" != "?" ] && { [ "$(code "$URL/f/$LINK")" = "200" ] && ok "family invitation page 200" || fail "family page not 200"; }
SUPERS="$(db_value "select authz.active_super_admins()::text v")"
[ "${SUPERS:-0}" != "0" ] && [ "$SUPERS" != "?" ] && ok "$SUPERS active super admin(s)" || fail "no active super admin"
STAGEUSER="$(db_value "select r.key v from user_role ur join role r on r.id = ur.role_id join app_user u on u.id = ur.user_id where u.email like 'stage@%' limit 1")"
[ "$STAGEUSER" = "stage_manager" ] || [ -z "$STAGEUSER" ] && ok "Stage 1 stage user kept access (role: ${STAGEUSER:-n/a})" || fail "stage user role is '$STAGEUSER'"

# ══════════════════════════════════════════════════════════════════════════════════════════════
step "Done"
[ "$FAILED" = "0" ] && printf "  ${G}${B}Stage 2 is live.${N}\n" || printf "  ${R}${B}%d check(s) failed — see above. Rollback command below.${N}\n" "$FAILED"
cat <<EOF

  App               $URL
  Sign in           $URL/login        (passwords unchanged; no quick-login in production)
  Super admin       $SUPER_ADMIN → Users and Roles: invite staff, assign roles with expiry,
                    edit role permissions, audit log, Weddings (create a real wedding)
  Families          Families and RSVP → Import CSV (name, phone, language, headcount_max)
  PinkyBua          the 💬 button on staff screens and on family links
  Integrations      $URL/ops/integrations
  Backup            ${BACKUP_FILE:-see .deploy/stage2-deploy.log}

  Manual smoke checklist (Stage 2):
    1. As $SUPER_ADMIN: Users and Roles → Weddings → create a wedding; switch to it in the top bar.
    2. Families and RSVP → Import CSV with 10 rows → download links and codes; open one link on a phone.
    3. Users and Roles → assign "Stage manager" to a user with an expiry 2 minutes ahead; it works, then 403.
    4. Suspend a signed-in user; their next click is denied. Reactivate.
    5. Try to remove the last super admin: refused.
    6. As host ask PinkyBua "RSVP totals?"; as stage@ ask "ledger totals?" → "I cannot access that".
    7. On a family link ask "where am I in the queue?"; ask to switch to Hindi → Confirm card.

  If something is wrong:  bash deploy/rollback-stage2.sh --project=$PROJECT --revision=${PREV_REV:-<previous>} --backup=${BACKUP_FILE:-<file>}
EOF
[ "$FAILED" = "0" ]
