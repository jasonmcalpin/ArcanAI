#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_URL="${CODEX_GUIDELINES_REPO:-https://github.com/jasonmcalpin/codex-engineering-guidelines.git}"

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

git clone --quiet --depth 1 "$SOURCE_URL" "$TMP/guidelines"
SKILLS="requirements-review architecture-review regression-fix change-verification refactoring"

# Validate all upstream skills before modifying project files.
for skill in $SKILLS; do
  [ -f "$TMP/guidelines/.agents/skills/$skill/SKILL.md" ] || {
    echo "Missing upstream skill: $skill" >&2
    exit 1
  }
done

mkdir -p "$ROOT/.agents/skills"
for skill in $SKILLS; do
  rm -rf "$ROOT/.agents/skills/$skill"
  cp -R "$TMP/guidelines/.agents/skills/$skill" "$ROOT/.agents/skills/$skill"
done

echo "Updated shared skills. Review: git diff -- .agents/skills"
