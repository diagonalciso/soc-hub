#!/usr/bin/env bash
# clone-all.sh — clone (or update) every git-kind service in fleet.tsv.
#
# Reads fleet.tsv (the fleet manifest) and, for each row whose kind is "git",
# clones diagonalciso/<repo> as a SIBLING of soc-hub if missing, or fast-forward
# pulls it if already present. External tiles (kind=external) are skipped.
#
# The fleet is deliberately ~20 standalone repos, NOT a monorepo/submodules —
# this script is the convenience layer over that, with zero coupling.
#
#   ./clone-all.sh          # clone missing + pull existing
#   ./clone-all.sh --dry    # print what it would do, change nothing
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
MANIFEST="fleet.tsv"
PARENT="$(cd .. && pwd)"           # repos are cloned next to soc-hub
DRY=0
[[ "${1:-}" == "--dry" ]] && DRY=1

[[ -f "$MANIFEST" ]] || { echo "missing $MANIFEST" >&2; exit 1; }

run() { if [[ $DRY -eq 1 ]]; then echo "  DRY: $*"; else "$@"; fi; }

while IFS=$'\t' read -r name port group kind source notes; do
  # skip comments and blank lines
  [[ -z "${name:-}" || "${name:0:1}" == "#" ]] && continue
  [[ "$kind" != "git" ]] && continue

  repo="${source##*/}"                    # org/repo -> repo
  dest="$PARENT/$repo"
  url="git@github.com:${source}.git"

  if [[ -d "$dest/.git" ]]; then
    echo "== $repo: present, pulling"
    run git -C "$dest" pull --ff-only
  else
    echo "== $repo: cloning ($url)"
    run git clone "$url" "$dest"
  fi
done < "$MANIFEST"

echo "done."
