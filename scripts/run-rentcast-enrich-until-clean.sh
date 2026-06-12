#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for pass in $(seq 1 30); do
  python3 scripts/property_hygiene.py --enrich --limit 150 --rentcast --no-mark-unresolved >/dev/null 2>&1 || true
  read -r health missing <<< "$(python3 scripts/property_hygiene.py --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['health_score'], d['report']['missing_count'])")"
  echo "pass=$pass health=$health missing=$missing"
  if [ "$missing" -eq 0 ]; then
    exit 0
  fi
done
