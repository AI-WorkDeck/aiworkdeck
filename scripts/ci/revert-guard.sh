#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# revert-guard: fail a PR that silently undoes recent base-branch changes
# (typically a squash built on a stale base). Usage:
#   revert-guard.sh <base-rev> <head-rev>      PR body in $PR_BODY (optional)
# A file is flagged when the PR head's blob equals the file as it was BEFORE one
# of the last N first-parent base commits touching it, and differs from base tip.
# This also covers deleting a file that such a commit added.
# Intentional reverts: put "revert-guard: allow <sha>" in the PR body.
# Hashed plugin build output (official-plugins/*/web/assets) is skipped: a rebuild
# legitimately deletes the previous hashed file.
set -euo pipefail

BASE=${1:?base rev}
HEAD=${2:?head rev}
N=${REVERT_GUARD_N:-30}
BODY=${PR_BODY:-}

blob() { git rev-parse -q --verify "$1:$2" 2>/dev/null || true; }

flagged=()      # full shas
reports=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  hb=$(blob "$HEAD" "$f")
  bb=$(blob "$BASE" "$f")
  [ "$hb" = "$bb" ] && continue
  # Newest first. If head equals the file as it was before commit Q, every
  # commit from the newest down to Q (touching f) is undone: flag them all.
  commits=($(git log --first-parent -n "$N" --format=%H "$BASE" -- "$f"))
  hit=-1
  for i in "${!commits[@]}"; do
    [ "$hb" = "$(blob "${commits[$i]}^" "$f")" ] && hit=$i
  done
  note=""; if [ -z "$hb" ]; then note=" (deleted)"; fi
  for ((i = 0; i <= hit; i++)); do
    flagged+=("${commits[$i]}")
    reports+=("${commits[$i]} $f$note")
  done
done < <(git diff --no-renames --name-only "$BASE...$HEAD" -- . ':(exclude,glob)official-plugins/*/web/assets/**')

[ ${#flagged[@]} -eq 0 ] && { echo "revert-guard: ok"; exit 0; }

while IFS= read -r sha; do
  echo "PR reverts ${sha:0:9} $(git log -1 --format=%s "$sha")"
  printf '%s\n' "${reports[@]}" | { grep "^$sha " || true; } | cut -d' ' -f2- | { head -5; cat >/dev/null; } | sed 's/^/    /'
  echo "    ($(printf '%s\n' "${reports[@]}" | grep -c "^$sha ") file(s))"
done < <(printf '%s\n' "${flagged[@]}" | sort -u)
fail=0
while IFS= read -r sha; do
  ok=0
  while IFS= read -r line; do
    line=${line%$'\r'}
    if [[ $line =~ ^[[:space:]]*revert-guard:[[:space:]]*allow[[:space:]]+([0-9a-f]{7,40})[[:space:]]*$ ]] \
       && [[ $sha == "${BASH_REMATCH[1]}"* ]]; then ok=1; break; fi
  done <<<"$BODY"
  if [ $ok -eq 0 ]; then echo "revert-guard: not allowed: ${sha:0:9}"; fail=1; fi
done < <(printf '%s\n' "${flagged[@]}" | sort -u)

if [ $fail -ne 0 ]; then
  cat <<MSG

This PR would silently undo recent changes on the base branch. Most likely the
branch was built on a stale base. Rebase onto current master and rebuild the PR.
If the revert is intentional, add one line per commit to the PR description:
  revert-guard: allow <sha>
MSG
  exit 1
fi
echo "revert-guard: all flagged commits explicitly allowed"
