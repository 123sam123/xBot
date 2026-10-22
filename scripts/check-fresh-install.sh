#!/usr/bin/env bash
# Checks that `pnpm install` alone leaves a working Electron binary on a fresh
# clone, so `pnpm dev` can start: electron-vite never downloads Electron, and
# stops with "Electron uninstall" when node_modules/electron/path.txt is
# missing. Clones HEAD (so commit first) into a temporary folder and installs
# there with an empty Electron cache, so nothing from this checkout or the usual
# cache counts. Needs the network for the download.
#
#   scripts/check-fresh-install.sh         Electron is downloaded and runs
#   scripts/check-fresh-install.sh --skip  ELECTRON_SKIP_BINARY_DOWNLOAD=1 downloads nothing
set -euo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
head=$(git -C "$repo" rev-parse HEAD)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git clone --quiet --no-checkout "$repo" "$work/xbot"
git -C "$work/xbot" checkout --quiet --detach "$head"
mkdir "$work/electron-cache"
export electron_config_cache="$work/electron-cache"
cd "$work/xbot"
echo "Fresh clone of ${head:0:7}, empty Electron cache."

if [ "${1:-}" = --skip ]; then
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install
  if [ -e node_modules/electron/path.txt ] || [ -n "$(ls -A "$electron_config_cache")" ]; then
    echo "FAIL: Electron was downloaded although ELECTRON_SKIP_BINARY_DOWNLOAD=1."
    exit 1
  fi
  echo "PASS: ELECTRON_SKIP_BINARY_DOWNLOAD=1 downloaded nothing."
  exit 0
fi

pnpm install
if [ ! -f node_modules/electron/path.txt ]; then
  echo "FAIL: node_modules/electron/path.txt is missing, so \`pnpm dev\` stops with \"Electron uninstall\"."
  exit 1
fi
# On Linux an unpackaged Electron aborts unless its sandbox is off (chrome-sandbox isn't root-owned).
version=$(ELECTRON_DISABLE_SANDBOX=1 pnpm exec electron --version)
expected="v$(node -p "require('electron/package.json').version")"
if [ "$version" != "$expected" ]; then
  echo "FAIL: \`electron --version\` printed \"$version\", expected $expected."
  exit 1
fi
echo "PASS: node_modules/electron/path.txt exists and \`electron --version\` prints $version."
