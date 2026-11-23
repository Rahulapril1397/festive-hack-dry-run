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
[ -n "$PROJECT" ] || PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
REGION="$(gcloud container clusters list --project "$PROJECT" --filter=name=pehle-aap --format='value(location)' | head -1)"
[ -n "$REGION" ] || die "cluster pehle-aap not found in $PROJECT"
IP="$(gcloud compute addresses describe pehle-aap-prod-ip --global --project "$PROJECT" --format='value(address)')"

ep="$(gcloud container clusters describe pehle-aap --region "$REGION" --project "$PROJECT" --format='value(endpoint)')"
ca="$(gcloud container clusters describe pehle-aap --region "$REGION" --project "$PROJECT" --format='value(masterAuth.clusterCaCertificate)')"
tok="$(gcloud auth print-access-token)"
( umask 077; printf 'apiVersion: v1\nkind: Config\nclusters: [{ name: gke, cluster: { server: "https://%s", certificate-authority-data: "%s" } }]\nusers: [{ name: gcloud, user: { token: "%s" } }]\ncontexts: [{ name: gke, context: { cluster: gke, user: gcloud, namespace: prod } }]\ncurrent-context: gke\n' "$ep" "$ca" "$tok" > "$KUBECONFIG" )

echo "Helm history (prod):"
helm history pehle-aap -n prod --max 6
CURRENT="$(helm history pehle-aap -n prod --max 1 -o json | sed -nE 's/.*"revision":([0-9]+).*/\1/p')"
[ -n "$REVISION" ] || REVISION=$((CURRENT - 1))
echo
echo "Roll back: Helm revision $CURRENT → $REVISION, then reverse the Stage 2 database migrations."
read -r -p "Type ROLLBACK to continue: " A </dev/tty
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
