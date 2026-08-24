#!/usr/bin/env bash
# Publish the SpacetimeDB module and immediately (re-)set the editor password.
#
# Usage: scripts/publish.sh [local|maincloud]
#   local     -> spacetime publish --server local xianxia
#   maincloud -> spacetime publish xianxia --yes  (default)
#
# Reads the editor password hash from ./editorpasswort (gitignored, sha256-hex
# of the chosen password - see web_client/editor.html / CLAUDE.md). The
# set_editor_password reducer no-ops if the password is already set, so this
# is safe to run on every publish, including republishes to an existing db.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${1:-maincloud}"
DB="xianxia"
PASSWORD_FILE="$REPO_ROOT/editorpasswort"

case "$TARGET" in
  local)
    SERVER_ARGS=(--server local)
    spacetime publish --server local "$DB"
    ;;
  maincloud)
    SERVER_ARGS=()
    spacetime publish "$DB" --yes
    ;;
  *)
    echo "Usage: $0 [local|maincloud]" >&2
    exit 1
    ;;
esac

if [[ ! -f "$PASSWORD_FILE" ]]; then
  echo "Warnung: $PASSWORD_FILE nicht gefunden - Editor-Passwort wird NICHT gesetzt." >&2
  echo "Lege die sha256-hex-Hash des gewuenschten Editor-Passworts dort ab und rufe" >&2
  echo "  spacetime call ${SERVER_ARGS[*]} $DB set_editor_password <hash>" >&2
  echo "manuell auf." >&2
  exit 0
fi

HASH="$(tr -d '[:space:]' < "$PASSWORD_FILE")"
echo "Setze Editor-Passwort (no-op, falls bereits gesetzt)..."
spacetime call "${SERVER_ARGS[@]}" -y "$DB" set_editor_password "$HASH"
