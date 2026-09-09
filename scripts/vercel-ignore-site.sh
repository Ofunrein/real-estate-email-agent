#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the lumenosis-site project (lumenosis.com).
#
# Contract, which is the opposite of what you'd guess:
#   exit 1  -> BUILD
#   exit 0  -> SKIP
#
# Purpose: lumenosis.com and app.lumenosis.com are two Vercel projects on one repository.
# Without this filter every push to main rebuilds both, so a landing-page copy change
# redeploys the email agent and vice versa. This makes the deploys independent again while
# keeping a single atomic history: one push, but only the affected site rebuilds.
#
# This project builds only when files under lumenosis-site/ changed. The site is
# self-contained (verified: no import from lumenosis-site reaches outside that directory),
# so a change to the parent's app/, lib/, or db/ cannot alter the rendered site.
#
# Two deliberate exceptions that must still trigger a site build:
#   * db/migrations/** — the site reads the demo datastore through
#     demo_public_api.lookup_room(); a migration can change that contract, so the site is
#     rebuilt to fail fast rather than drift.
#   * this script and the workflow that guards it.
#
# Fail-open by design: if the diff cannot be computed (shallow clone, missing base, first
# deploy) we exit 1 and build. A needless build is cheap; a silently skipped deploy that
# leaves prod stale is not.

set -uo pipefail

WATCHED_REGEX='^(lumenosis-site/|db/migrations/|scripts/vercel-ignore-)'

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
head="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

if [ -z "$base" ]; then
  # No previous SHA: first deploy on this project, or Vercel did not supply one.
  # Try the commit's parent before giving up.
  base="$(git rev-parse --verify --quiet "${head}^" || true)"
fi

if [ -z "$base" ]; then
  echo "no base commit available; building (fail-open)"
  exit 1
fi

if ! changed="$(git diff --name-only "$base" "$head" 2>/dev/null)"; then
  echo "could not diff $base..$head; building (fail-open)"
  exit 1
fi

if [ -z "$changed" ]; then
  echo "empty diff $base..$head; building (fail-open)"
  exit 1
fi

if printf '%s\n' "$changed" | grep -qE "$WATCHED_REGEX"; then
  echo "site-relevant changes detected; building:"
  printf '%s\n' "$changed" | grep -E "$WATCHED_REGEX" | sed 's/^/  /' | head -20
  exit 1
fi

echo "no changes under lumenosis-site/ or db/migrations/; skipping site build"
exit 0
