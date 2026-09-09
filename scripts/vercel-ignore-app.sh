#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the real-estate-email-agent project (app.lumenosis.com).
#
# Contract:
#   exit 1  -> BUILD
#   exit 0  -> SKIP
#
# Mirror of scripts/vercel-ignore-site.sh. This project builds the repository root and owns
# the demo datastore, voice agent, generation and admin surfaces. It should NOT rebuild for
# a pure marketing-copy or landing-image change under lumenosis-site/.
#
# Rule: skip only when EVERY changed path is under lumenosis-site/. Anything else — app/,
# lib/, db/, scripts/, workflows, package manifests — builds.
#
# Note the asymmetry with the site filter, which is intentional. The site rebuilds on
# db/migrations/** because it consumes the demo_public_api contract; the parent does not
# rebuild on lumenosis-site/** because nothing at the root imports from the site.
#
# Fail-open: if the diff cannot be computed, build.

set -uo pipefail

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
head="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

if [ -z "$base" ]; then
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

# Any path that is NOT under lumenosis-site/ means this app must build.
if printf '%s\n' "$changed" | grep -qvE '^lumenosis-site/'; then
  echo "app-relevant changes detected; building:"
  printf '%s\n' "$changed" | grep -vE '^lumenosis-site/' | sed 's/^/  /' | head -20
  exit 1
fi

echo "changes confined to lumenosis-site/; skipping app build"
exit 0
