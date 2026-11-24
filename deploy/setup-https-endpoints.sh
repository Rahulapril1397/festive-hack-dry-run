#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────
# Free https hostname on Google Cloud, no purchased domain (minimal demo plan).
#
#   bash deploy/setup-https-endpoints.sh            # create the name, wait for DNS, print next steps
#   bash deploy/setup-https-endpoints.sh --print-only   # just print the API description it would deploy
#   bash deploy/setup-https-endpoints.sh --status       # DNS answer + managed certificate status
#
# What it does, following Google's "Configuring DNS on the cloud.goog domain" guide:
#   1. enables the Service Management, Service Control and Endpoints APIs,
#   2. deploys a minimal API description whose host is  pehle-aap.endpoints.<project>.cloud.goog
#      and whose x-google-endpoints target is the reserved static IP — Google then creates the A record,
#   3. waits until the name resolves to that IP.
# Then deploy with:  bash deploy/gcp-deploy.sh --yes --no-jobs --domain=<that hostname>
# which makes the ingress request a Google-managed certificate (can take up to 60 minutes).
#
# NOT VERIFIED: Google documents the hostname and the DNS record; I found no statement that a
# managed certificate is issued for an *.endpoints.<project>.cloud.goog name. Check with --status.
# If the certificate never becomes Active, show voice from the laptop on localhost instead.
# ──────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$ROOT/.deploy/bin:$PATH" KUBECONFIG="$ROOT/.deploy/kubeconfig"

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
NAME="${ENDPOINT_NAME:-pehle-aap}"
IP_NAME="pehle-aap-prod-ip"
MODE="create"
for a in "$@"; do
  case "$a" in
    --project=*) PROJECT="${a#*=}" ;;
    --name=*) NAME="${a#*=}" ;;
    --print-only) MODE="print" ;;
    --status) MODE="status" ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 2 ;;
  esac
done
[ -n "$PROJECT" ] || { echo "No GCP project: pass --project=ID or run 'gcloud config set project ID'"; exit 1; }
HOST="$NAME.endpoints.$PROJECT.cloud.goog"

if [ "$MODE" = "print" ]; then IP="${IP:-<static IP>}"; else
  IP="$(gcloud compute addresses describe "$IP_NAME" --global --project "$PROJECT" --format='value(address)' 2>/dev/null || true)"
  [ -n "$IP" ] || { echo "Static IP $IP_NAME not found (reserve it with deploy/gcp-deploy.sh first)"; exit 1; }
fi

spec() {
  cat <<YAML
swagger: "2.0"
info:
  title: Pehle Aap hostname
  version: "1.0.0"
host: "$HOST"
x-google-endpoints:
  - name: "$HOST"
    target: "$IP"
schemes: [https]
produces: [application/json]
paths:
  /ping:
    get:
      operationId: ping
      responses:
        "200": { description: ok }
YAML
}

case "$MODE" in
  print) spec; exit 0 ;;
  status)
    echo "Host: $HOST (expected IP $IP)"
    echo "DNS:  $(getent hosts "$HOST" 2>/dev/null | awk '{print $1}' || true)  $(command -v dig >/dev/null && dig +short "$HOST" | head -1 || true)"
    echo "Managed certificate (namespace prod):"
    kubectl get managedcertificate -n prod 2>&1 | sed 's/^/  /' || true
    exit 0 ;;
esac

echo "Project $PROJECT → $HOST → $IP"
gcloud services enable servicemanagement.googleapis.com servicecontrol.googleapis.com endpoints.googleapis.com --project "$PROJECT"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
spec > "$TMP/openapi.yaml"
gcloud endpoints services deploy "$TMP/openapi.yaml" --project "$PROJECT"

echo "Waiting for DNS (Google says a few minutes)…"
for i in $(seq 1 30); do
  GOT="$( (getent hosts "$HOST" 2>/dev/null || true) | awk '{print $1}' | head -1)"
  [ -z "$GOT" ] && command -v dig >/dev/null && GOT="$(dig +short "$HOST" | head -1)"
  if [ "$GOT" = "$IP" ]; then echo "DNS ok: $HOST → $GOT"; break; fi
  sleep 10
  [ "$i" = 30 ] && echo "Not resolving yet (last answer: '${GOT:-none}'). Re-run with --status in a few minutes."
done
echo
echo "Next:  bash deploy/gcp-deploy.sh --yes --no-jobs --domain=$HOST"
echo "Then:  node scripts/set-auth-urls.mjs https://$HOST   (Supabase sign-in redirect URLs)"
echo "Check: bash deploy/setup-https-endpoints.sh --status   (certificate must read Active)"
