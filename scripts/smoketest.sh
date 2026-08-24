#!/usr/bin/env bash
# Black-box smoke test for the single-identity reducer flows: register, qi
# collection, movement/collision, durchbruch, duplicate-name guard. Drives one
# stable identity throughout a single run (see scripts/test_relogin.mjs for
# the relogin/multi-identity scenario, which this script cannot express -
# `spacetime call` has no way to reuse a specific non-default identity across
# calls, only the CLI's one persistent default).
#
# That persistent default identity is exactly the problem for *repeatability*:
# it's the same across separate runs of this script too, so a second run's
# `register` call would silently no-op (this identity already owns a player
# row from the first run) instead of creating a fresh one. Fixed by pointing
# XDG_CONFIG_HOME at a throwaway temp dir for the whole script run - the CLI
# auto-generates and caches a brand-new identity there on first use, reused
# for every subsequent call *within this run* (confirmed live: two calls
# sharing an XDG_CONFIG_HOME act on the same player; a fresh one each run
# means `register` genuinely gets exercised fresh every time).
#
# Usage: scripts/smoketest.sh [local|maincloud]
#   local     -> spacetime call/sql --server local xianxia ...  (default)
#   maincloud -> spacetime call/sql xianxia ...
#
# Defaults to `local` (unlike publish.sh/players.sh, which default to
# maincloud) since this registers throwaway test players and calls reducers
# for real - that should never happen against maincloud by accident.

set -euo pipefail

TARGET="${1:-local}"
DB="xianxia"

export XDG_CONFIG_HOME
XDG_CONFIG_HOME="$(mktemp -d)"
trap 'rm -rf "$XDG_CONFIG_HOME"' EXIT

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

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  OK: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL: $1" >&2; }

call() {
  spacetime call "${SERVER_ARGS[@]}" -y "$DB" "$@" >/dev/null
}

# Runs a SELECT and prints the first row as a JSON array, e.g. [123,"name",0]
sql_row() {
  spacetime sql "${SERVER_ARGS[@]}" "$DB" --format json "$1" 2>/dev/null \
    | jq -c '.[0].rows[0] // empty'
}

sql_count() {
  spacetime sql "${SERVER_ARGS[@]}" "$DB" --format json "$1" 2>/dev/null \
    | jq -c '.[0].rows | length'
}

NAME="smoketest_$(date +%s)"
PASSWORD_HASH="deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

echo "=== 1. Register '$NAME' ==="
call register "\"$NAME\"" "\"$PASSWORD_HASH\""
sleep 0.2
row="$(sql_row "SELECT player_id, qi, qi_maximum, pos_x, pos_y FROM player WHERE name = '$NAME'")"
if [[ -n "$row" ]] && [[ "$(echo "$row" | jq '.[1]')" == "0" ]]; then
  ok "player row created with qi=0 ($row)"
else
  bad "expected a fresh player row with qi=0, got: ${row:-<none>}"
fi
PLAYER_ID="$(echo "$row" | jq -r '.[0]')"

echo "=== 2. qi_sammeln increments by 10, clamps at qi_maximum ==="
QI_BEFORE="$(echo "$row" | jq '.[1]')"
call qi_sammeln
sleep 0.2
row="$(sql_row "SELECT qi, qi_maximum FROM player WHERE player_id = $PLAYER_ID")"
QI_AFTER="$(echo "$row" | jq '.[0]')"
if [[ "$QI_AFTER" -eq $((QI_BEFORE + 10)) ]]; then
  ok "qi went $QI_BEFORE -> $QI_AFTER"
else
  bad "expected qi $QI_BEFORE -> $((QI_BEFORE + 10)), got $QI_AFTER"
fi

QI_MAXIMUM="$(echo "$row" | jq '.[1]')"
for _ in $(seq 1 12); do call qi_sammeln; sleep 0.1; done
row="$(sql_row "SELECT qi FROM player WHERE player_id = $PLAYER_ID")"
QI_AFTER="$(echo "$row" | jq '.[0]')"
if [[ "$QI_AFTER" -eq "$QI_MAXIMUM" ]]; then
  ok "qi clamped at qi_maximum ($QI_AFTER)"
else
  bad "expected qi clamped at $QI_MAXIMUM, got $QI_AFTER"
fi

echo "=== 3. update_position: walkable succeeds, water/mountain blocked ==="
row="$(sql_row "SELECT pos_x, pos_y FROM player WHERE player_id = $PLAYER_ID")"
call update_position "129.0" "128.0"
sleep 0.2
row="$(sql_row "SELECT pos_x, pos_y FROM player WHERE player_id = $PLAYER_ID")"
if [[ "$(echo "$row" | jq '.[0] == 129 and .[1] == 128')" == "true" ]]; then
  ok "position updated to walkable tile (129, 128)"
else
  bad "expected position (129, 128), got $row"
fi

blocked_tile="$(sql_row "SELECT x, y FROM world_tile WHERE biom_typ = 0 OR biom_typ = 4 LIMIT 1")"
if [[ -n "$blocked_tile" ]]; then
  BX="$(echo "$blocked_tile" | jq '.[0]')"
  BY="$(echo "$blocked_tile" | jq '.[1]')"
  before="$(sql_row "SELECT pos_x, pos_y FROM player WHERE player_id = $PLAYER_ID")"
  call update_position "${BX}.0" "${BY}.0"
  sleep 0.2
  after="$(sql_row "SELECT pos_x, pos_y FROM player WHERE player_id = $PLAYER_ID")"
  if [[ "$before" == "$after" ]]; then
    ok "position unchanged after targeting water/mountain tile ($BX, $BY)"
  else
    bad "expected position unchanged targeting ($BX, $BY), was $before, now $after"
  fi
else
  bad "could not find a water/mountain tile to test collision against"
fi

echo "=== 4. durchbruch: qi maxed, retry until success ==="
row="$(sql_row "SELECT qi, qi_maximum, stufe FROM player WHERE player_id = $PLAYER_ID")"
STUFE_BEFORE="$(echo "$row" | jq '.[2]')"
QI_MAXIMUM_BEFORE="$(echo "$row" | jq '.[1]')"
success=false
for _ in $(seq 1 40); do
  call durchbruch
  sleep 0.1
  row="$(sql_row "SELECT qi, qi_maximum, stufe FROM player WHERE player_id = $PLAYER_ID")"
  STUFE_NOW="$(echo "$row" | jq '.[2]')"
  if [[ "$STUFE_NOW" -gt "$STUFE_BEFORE" ]]; then
    success=true
    break
  fi
  # a failed attempt halves qi to qi_maximum/2 - refill before retrying
  for _ in $(seq 1 12); do call qi_sammeln; sleep 0.05; done
done
if $success; then
  QI_MAXIMUM_AFTER="$(echo "$row" | jq '.[1]')"
  QI_AFTER="$(echo "$row" | jq '.[0]')"
  expected_max=$(( QI_MAXIMUM_BEFORE * 3 / 2 ))
  if [[ "$QI_MAXIMUM_AFTER" -eq "$expected_max" ]] && [[ "$QI_AFTER" -eq 0 ]]; then
    ok "durchbruch succeeded: stufe $STUFE_BEFORE -> $STUFE_NOW, qi_maximum $QI_MAXIMUM_BEFORE -> $QI_MAXIMUM_AFTER, qi reset to 0"
  else
    bad "durchbruch succeeded but qi_maximum/qi look wrong: qi_maximum=$QI_MAXIMUM_AFTER (expected $expected_max), qi=$QI_AFTER (expected 0)"
  fi
else
  bad "durchbruch never succeeded after 40 retries (chance is 85% at stufe 0 - this would be extraordinarily unlucky, or a real bug)"
fi

echo "=== 5. Register with a duplicate name no-ops ==="
COUNT_BEFORE="$(sql_count "SELECT player_id FROM player WHERE name = '$NAME'")"
call register "\"$NAME\"" "\"anotherhash\""
sleep 0.2
COUNT_AFTER="$(sql_count "SELECT player_id FROM player WHERE name = '$NAME'")"
if [[ "$COUNT_BEFORE" == "1" ]] && [[ "$COUNT_AFTER" == "1" ]]; then
  ok "duplicate-name register no-op'd (still exactly 1 row named '$NAME')"
else
  bad "expected exactly 1 row named '$NAME' before and after, got $COUNT_BEFORE -> $COUNT_AFTER"
fi

echo
echo "=== Summary: $PASS passed, $FAIL failed ==="
[[ "$FAIL" -eq 0 ]]
