#!/usr/bin/env bash
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-$HOME/life-dashboard}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
GIT_REPO="${GIT_REPO:-https://github.com/$(git config --get remote.origin.url 2>/dev/null | sed -E 's#(https://github.com/|git@github.com:|git://github.com/)##; s#\.git$##') }"

if [ -z "${GIT_REPO:-}" ] || [ "$GIT_REPO" = "https://github.com/" ]; then
  echo "GIT_REPO is not set and no GitHub remote was found."
  exit 1
fi

mkdir -p "$(dirname "$DEPLOY_PATH")"

if [ ! -d "$DEPLOY_PATH/.git" ]; then
  git clone "$GIT_REPO" "$DEPLOY_PATH"
fi

cd "$DEPLOY_PATH"
git config --global --add safe.directory "$DEPLOY_PATH"
git fetch --all --prune
git checkout "$DEPLOY_BRANCH"
git pull --ff-only origin "$DEPLOY_BRANCH"

docker compose down --remove-orphans || true
docker compose up -d --build
docker compose ps
