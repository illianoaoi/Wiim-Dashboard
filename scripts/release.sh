#!/usr/bin/env bash
# Cut a release: bump package.json (single source of truth), tag, push, publish.
#
#   ./scripts/release.sh patch     # 0.1.0 -> 0.1.1
#   ./scripts/release.sh minor     # 0.1.0 -> 0.2.0
#   ./scripts/release.sh major     # 0.1.0 -> 1.0.0
#   ./scripts/release.sh 1.2.3     # explicit version
#
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-}"
if [ -z "$BUMP" ]; then
  echo "Usage: ./scripts/release.sh <patch|minor|major|x.y.z>"; exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || { echo "❌ Switch to main first (on: $branch)"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "❌ Commit or stash changes first."; exit 1; }

# Commits/tags use the repo-local git identity (keep it set to your alias):
#   git config user.name "illiano"
#   git config user.email "illiano@users.noreply.github.com"
NEW=$(npm version "$BUMP" -m "release: %s")     # bumps package.json, commits, tags vX.Y.Z
echo "→ bumped to $NEW"

# Pushing the tag triggers .github/workflows/release.yml, which builds the
# multi-arch Docker image (GHCR) and publishes the GitHub release.
git push --follow-tags origin main

echo "✅ Pushed $NEW — GitHub Actions will build the image + publish the release."
echo "   Watch: https://github.com/illianoaoi/Wiim-Dashboard/actions"
echo "   Pull:  docker pull ghcr.io/illianoaoi/wiim-dashboard:${NEW#v}"
