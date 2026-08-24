#!/usr/bin/env bash
# List all registered players.
#
# Usage: scripts/players.sh [local|maincloud]
#   local     -> spacetime sql --server local xianxia ...
#   maincloud -> spacetime sql xianxia ...  (default)

set -euo pipefail

TARGET="${1:-maincloud}"
DB="xianxia"

case "$TARGET" in
  local)
    SERVER_ARGS=(--server local)
    ;;
  maincloud)
    SERVER_ARGS=()
    ;;
  *)
    echo "Usage: $0 [local|maincloud]" >&2
    exit 1
    ;;
esac

spacetime sql "${SERVER_ARGS[@]}" "$DB" \
  "SELECT player_id, name, stufe, qi, qi_maximum, pos_x, pos_y FROM player"
