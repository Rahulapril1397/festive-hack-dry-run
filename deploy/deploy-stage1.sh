#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────
# Deploy Stage 1 (git tag "stage-1") to GCP — first install, or redeploy of a Stage 1 production.
#
#   bash deploy/deploy-stage1.sh --project=festive-hack-dry-run
#
# Builds exactly the code at tag stage-1, from a separate checkout in .deploy/stage1-src, so your
# working copy (Stage 2) is not touched. Uses that tag's own deploy/gcp-deploy.sh: APIs, registry,
# Autopilot cluster, static IP, Secret Manager, Stage 1 migrations, image, helm, health check.
#
# Refuses if production already runs Stage 2 — going back is bash deploy/rollback-stage2.sh.
# Next stage: bash deploy/deploy-stage2.sh
# ──────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TAG="stage-1"
SRC="$ROOT/.deploy/stage1-src"

PROJECT=""
for a in "$@"; do
  case "$a" in
    --project=*) PROJECT="${a#*=}" ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 2 ;;
  esac
done
die() { printf "\n✗ %s\n" "$*" >&2; exit 1; }
ok() { printf "  ✓ %s\n" "$*"; }

command -v git >/dev/null || die "git not found"
command -v node >/dev/null && command -v npm >/dev/null || die "node/npm not found"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "tag $TAG not found (git fetch --tags)"
[ -f .env.local ] || die ".env.local not found"

# Production must not already be on Stage 2 (a Stage 1 image cannot sign anyone in there).
set -a; . ./.env.local; set +a
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL missing in .env.local"
[ -d node_modules ] || npm ci --silent
STATE="$(Q="select (to_regnamespace('authz') is not null or exists (select 1 from role where key = 'stage_manager')) as s2" node --input-type=module -e '
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try { const [r] = await s.unsafe(process.env.Q); console.log(r.s2 ? "stage2" : "stage1"); }
catch { console.log("empty"); } finally { await s.end(); }')"
case "$STATE" in
  stage2) die "Production is on Stage 2. To go back to Stage 1 use: bash deploy/rollback-stage2.sh --project=${PROJECT:-<project>}" ;;
  stage1) ok "database is on Stage 1" ;;
  *) ok "database is empty — first install" ;;
esac

# Separate checkout of the tag (reused on later runs).
if [ -d "$SRC/.git" ] || [ -f "$SRC/.git" ]; then
  git -C "$SRC" checkout -q --detach "$TAG"
else
  git worktree prune
  git worktree add --detach "$SRC" "$TAG" >/dev/null
fi
ok "code at $TAG ($(git -C "$SRC" rev-parse --short HEAD)) in .deploy/stage1-src"
cp .env.local "$SRC/.env.local"
chmod 600 "$SRC/.env.local"
[ -d "$SRC/node_modules" ] || (cd "$SRC" && echo "  installing npm dependencies for ${TAG}…" && npm ci --silent)

ARGS=(--domain=)
[ -n "$PROJECT" ] && ARGS+=(--project="$PROJECT")
exec /bin/bash "$SRC/deploy/gcp-deploy.sh" "${ARGS[@]}"
