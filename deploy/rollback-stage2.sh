#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────
# Roll production back from Stage 2 to Stage 1.
#
#   bash deploy/rollback-stage2.sh --project=festive-hack-dry-run [--revision=N]
#
# 1. helm rollback to the last Stage 1 revision (default: the one before the current one).
# 2. Apply deploy/stage2-down.sql: reverses migrations 0204/0110/0011/0010 in one transaction,
#    keeping all wedding data (families, RSVPs, check-ins, queue, ledger, photos, audit log).
#    Tested: the resulting schema is identical to Stage 1.
# 3. Verify the old version answers and Stage 1 sign-in works.
# The pg_dump taken by deploy-stage2.sh (~/pehle-backups) is the last resort if this fails.
# If the database is not on Stage 2, it stops before changing anything.
# ──────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$ROOT/.deploy/bin:$PATH" KUBECONFIG="$ROOT/.deploy/kubeconfig"

PROJECT=""; REVISION=""
for a in "$@"; do
  case "$a" in
    --project=*) PROJECT="${a#*=}" ;;
    --revision=*) REVISION="${a#*=}" ;;
    --backup=*) ;; # printed by deploy-stage2.sh for reference; not needed here
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a"; exit 2 ;;
  esac
done
die() { printf "\n✗ %s\n" "$*" >&2; exit 1; }
ok() { printf "  ✓ %s\n" "$*"; }

command -v helm >/dev/null && command -v kubectl >/dev/null || die "helm/kubectl not found in .deploy/bin — run deploy/gcp-deploy.sh --tools-only first"
[ -f .env.local ] || die ".env.local not found"
set -a; . ./.env.local; set +a
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL missing in .env.local"
# Is production actually on Stage 2? Checked before anything is changed.
STATE="$(Q="select (to_regnamespace('authz') is not null or exists (select 1 from role where key = 'stage_manager')) as stage2" node --input-type=module -e '
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try { const [r] = await s.unsafe(process.env.Q); console.log(r.stage2 ? "stage2" : "stage1"); }
catch { console.log("unknown"); } finally { await s.end(); }')"
case "$STATE" in
  stage1) echo "Production is on Stage 1 (no Stage 2 migrations applied). Nothing to roll back — nothing was changed."; exit 0 ;;
  stage2) ok "database is on Stage 2" ;;
  *) die "Could not read the database state; not changing anything." ;;
esac

[ -n "$PROJECT" ] || PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
REGION="$(gcloud container clusters list --project "$PROJECT" --filter=name=pehle-aap --format='value(location)' | head -1)"
[ -n "$REGION" ] || die "cluster pehle-aap not found in $PROJECT"
IP="$(gcloud compute addresses describe pehle-aap-prod-ip --global --project "$PROJECT" --format='value(address)')"

ep="$(gcloud container clusters describe pehle-aap --region "$REGION" --project "$PROJECT" --format='value(endpoint)')"
ca="$(gcloud container clusters describe pehle-aap --region "$REGION" --project "$PROJECT" --format='value(masterAuth.clusterCaCertificate)')"
tok="$(gcloud auth print-access-token)"
( umask 077; printf 'apiVersion: v1\nkind: Config\nclusters: [{ name: gke, cluster: { server: "https://%s", certificate-authority-data: "%s" } }]\nusers: [{ name: gcloud, user: { token: "%s" } }]\ncontexts: [{ name: gke, context: { cluster: gke, user: gcloud, namespace: prod } }]\ncurrent-context: gke\n' "$ep" "$ca" "$tok" > "$KUBECONFIG" )

echo "Helm history (prod), with the image each revision ran:"
helm history pehle-aap -n prod --max 6
for r in $(helm history pehle-aap -n prod --max 6 -o json | grep -oE '"revision":[0-9]+' | cut -d: -f2); do
  printf "  revision %s: image %s\n" "$r" "$(helm get values pehle-aap -n prod --revision "$r" -a -o json 2>/dev/null | grep -oE '"tag":"[^"]+"' | head -1 | cut -d'"' -f4)"
done
echo "  (pick the last revision from before the Stage 2 deploy)"
CURRENT="$(helm history pehle-aap -n prod --max 1 -o json | sed -nE 's/.*"revision":([0-9]+).*/\1/p')"
[ -n "$REVISION" ] || REVISION=$((CURRENT - 1))
echo
echo "Roll back: Helm revision $CURRENT → $REVISION, then reverse the Stage 2 database migrations."
A=""; if { exec 3</dev/tty; } 2>/dev/null; then read -r -p "Type ROLLBACK to continue: " A <&3 || true; exec 3<&-; fi
[ "$A" = "ROLLBACK" ] || { echo "Cancelled. Nothing changed."; exit 0; }

helm rollback pehle-aap "$REVISION" -n prod --wait --timeout 10m
ok "app rolled back to revision $REVISION"
node scripts/run-sql.mjs deploy/stage2-down.sql || die "Database rollback failed (no changes were committed). Restore from ~/pehle-backups if needed."
ok "database back to the Stage 1 schema (data kept)"
kubectl rollout restart deployment/pehle-aap -n prod >/dev/null && kubectl rollout status deployment/pehle-aap -n prod --timeout=10m
H="$(curl -fsS --max-time 10 "http://$IP/api/health" || true)"
ok "health: ${H:-no answer}"
echo
echo "Stage 1 is back at http://$IP. Sign in as before (stage@…, admin@…)."
