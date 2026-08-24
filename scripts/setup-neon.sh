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

# Reuse before create. `neon projects create` always makes a NEW project, so a
# second run used to leave an orphaned database behind and repoint .env at the
# duplicate. Creating a Neon project is also billable past the free tier, which
# makes an accidental second one worse than a wasted minute.
PROJECT_ID="$(neon projects list --api-key "$NEON_API_KEY" --analytics false --output json \
  | jq -r --arg name "$PROJECT_NAME" '(.projects // .) | map(select(.name == $name)) | .[0].id // empty')"

if [[ -n "$PROJECT_ID" ]]; then
  echo "Reusing existing Neon project '$PROJECT_NAME' ($PROJECT_ID)."
  BRANCH_ID="$(neon branches list --project-id "$PROJECT_ID" --api-key "$NEON_API_KEY" --analytics false --output json \
    | jq -r '(.branches // .) | map(select(.default == true)) | .[0].id // empty')"
  DATABASE_URL_VALUE=""
else
  PROJECT_ARGS=(projects create --name "$PROJECT_NAME" --region-id "$REGION_ID" --database "$DATABASE_NAME" --role "$ROLE_NAME" --set-context --api-key "$NEON_API_KEY" --output json)
  if [[ -n "${NEON_ORG_ID:-}" ]]; then
    PROJECT_ARGS+=(--org-id "$NEON_ORG_ID")
  fi

  PROJECT_JSON="$(neon "${PROJECT_ARGS[@]}")"
  PROJECT_ID="$(printf '%s' "$PROJECT_JSON" | jq -r '.project.id')"
  BRANCH_ID="$(printf '%s' "$PROJECT_JSON" | jq -r '.branch.id // .branches[0].id // .project.default_branch_id // empty')"
  DATABASE_URL_VALUE="$(printf '%s' "$PROJECT_JSON" | jq -r '.connection_uris[0].connection_uri_pooler // .connection_uris[0].connection_uri // .connection_uri_pooler // .connection_uri')"
fi

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

# Write to clients/<id>.env, not the shared repo .env. One .env cannot hold
# three clients, and overwriting it during a second client's provision is how a
# deployment ends up pointed at the wrong database.
if [[ "$CLIENT_ID_VALUE" == "default" ]]; then
  ENV_TARGET=".env"
else
  mkdir -p clients
  ENV_TARGET="clients/${CLIENT_ID_VALUE}.env"
  [[ -f "$ENV_TARGET" ]] || : > "$ENV_TARGET"
fi

export DATABASE_URL_VALUE CLIENT_ID_VALUE CLIENT_NAME_VALUE ENV_TARGET

python3 - <<'PY'
from pathlib import Path
import os

env_path = Path(os.environ["ENV_TARGET"])
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

# Ledgered runner, not a bare psql loop. The old loop re-ran all 28 files on
# every provision and, without ON_ERROR_STOP, psql continued past a failed
# statement and still exited 0 — reporting a half-applied schema as clean.
# migrate.mjs tracks applied files, runs each in a transaction, and seeds the
# clients row that ~45 foreign keys depend on.
DATABASE_URL="$DATABASE_URL_VALUE" CLIENT_ID="$CLIENT_ID_VALUE" CLIENT_NAME="$CLIENT_NAME_VALUE" \
  node scripts/migrate.mjs

echo "Neon project ready: $PROJECT_ID"
echo "Branch: $BRANCH_ID"
echo "Database: $DATABASE_NAME"
echo "Role: $ROLE_NAME"
echo "Wrote DATABASE_URL to $ENV_TARGET and applied pending migrations."
echo
echo "Sheets sync is no longer run automatically — it is optional and only"
echo "applies to clients using the Sheets workbook. Run: npm run sync:sheets"
