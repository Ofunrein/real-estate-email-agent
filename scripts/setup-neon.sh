#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      value="${value%\"}"
      value="${value#\"}"
      if [[ -z "${!key:-}" ]]; then
        export "$key=$value"
      fi
    fi
  done < .env
fi

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 1
  fi
}

required NEON_API_KEY

PROJECT_NAME="${NEON_PROJECT_NAME:-real-estate-agent-inbox}"
REGION_ID="${NEON_REGION_ID:-aws-us-east-1}"
DATABASE_NAME="${NEON_DATABASE_NAME:-agent_os}"
ROLE_NAME="${NEON_ROLE_NAME:-agent_os_app}"
CLIENT_NAME_VALUE="${CLIENT_NAME:-Default Client}"
CLIENT_ID_VALUE="${CLIENT_ID:-default}"

if ! command -v neon >/dev/null 2>&1; then
  brew install neonctl
fi

if [[ -z "${NEON_ORG_ID:-}" ]]; then
  NEON_ORG_ID="$(neon orgs list --api-key "$NEON_API_KEY" --analytics false --output json | jq -r '.[0].id // empty')"
fi

PROJECT_ARGS=(projects create --name "$PROJECT_NAME" --region-id "$REGION_ID" --database "$DATABASE_NAME" --role "$ROLE_NAME" --set-context --api-key "$NEON_API_KEY" --output json)
if [[ -n "${NEON_ORG_ID:-}" ]]; then
  PROJECT_ARGS+=(--org-id "$NEON_ORG_ID")
fi

PROJECT_JSON="$(neon "${PROJECT_ARGS[@]}")"
PROJECT_ID="$(printf '%s' "$PROJECT_JSON" | jq -r '.project.id')"
BRANCH_ID="$(printf '%s' "$PROJECT_JSON" | jq -r '.branch.id // .branches[0].id // .project.default_branch_id // empty')"
DATABASE_URL_VALUE="$(printf '%s' "$PROJECT_JSON" | jq -r '.connection_uris[0].connection_uri_pooler // .connection_uris[0].connection_uri // .connection_uri_pooler // .connection_uri')"

if [[ -z "$DATABASE_URL_VALUE" || "$DATABASE_URL_VALUE" == "null" ]]; then
  DATABASE_URL_VALUE="$(neon connection-string "$BRANCH_ID" \
    --project-id "$PROJECT_ID" \
    --database-name "$DATABASE_NAME" \
    --role-name "$ROLE_NAME" \
    --pooled \
    --api-key "$NEON_API_KEY" \
    --output json | jq -r '.uri')"
fi

if [[ -z "$DATABASE_URL_VALUE" || "$DATABASE_URL_VALUE" == "null" ]]; then
  echo "Unable to determine DATABASE_URL from Neon CLI output." >&2
  exit 1
fi

DATABASE_URL_VALUE="${DATABASE_URL_VALUE/\?sslmode=require/}"
DATABASE_URL_VALUE="${DATABASE_URL_VALUE/&sslmode=require/}"

export DATABASE_URL_VALUE CLIENT_ID_VALUE CLIENT_NAME_VALUE

python3 - <<'PY'
from pathlib import Path
import os

env_path = Path(".env")
updates = {
    "DATABASE_URL": os.environ["DATABASE_URL_VALUE"],
    "DATABASE_SSL": "true",
    "CLIENT_ID": os.environ.get("CLIENT_ID_VALUE", "default"),
    "CLIENT_NAME": os.environ.get("CLIENT_NAME_VALUE", "Default Client"),
}

lines = []
if env_path.exists():
    lines = env_path.read_text().splitlines()

remaining = dict(updates)
new_lines = []
for line in lines:
    replaced = False
    for key, value in list(remaining.items()):
        if line.startswith(f"{key}="):
            new_lines.append(f"{key}={value}")
            remaining.pop(key)
            replaced = True
            break
    if not replaced:
        new_lines.append(line)

for key, value in remaining.items():
    new_lines.append(f"{key}={value}")

env_path.write_text("\n".join(new_lines) + "\n")
PY

for migration in db/migrations/*.sql; do
  psql "$DATABASE_URL_VALUE" -f "$migration"
done
npm run sync:sheets

echo "Neon project created: $PROJECT_ID"
echo "Branch: $BRANCH_ID"
echo "Database: $DATABASE_NAME"
echo "Role: $ROLE_NAME"
echo "Updated .env with DATABASE_URL and synced current Sheets data."
