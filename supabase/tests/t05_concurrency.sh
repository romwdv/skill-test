#!/usr/bin/env bash
# Atomicity: N participants draw simultaneously (own connection each) and no two
# ever receive the same target. The advisory lock serializes draws; the unique
# constraint on attributions.target_id is the backstop that makes a target
# collision impossible. (Solvability — every draw finding a valid target — is
# ticket #5's greedy algorithm, not this test's concern.)

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

rounds=5
per_round=12

links_for_round() {
  local round=$1
  for i in $(seq 1 "$per_round"); do
    printf '1%s000000-0000-4000-8000-0000000000%02d\n' "$round" "$i"
  done
}

"${PSQL[@]}" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -c "truncate attributions, couples, participants;" >/dev/null

seed() {
  local round=$1 vals=()
  local -i n=0
  while IFS= read -r link; do
    n=$((n + 1))
    vals+=("('Concurrent r$round p$n', '$link')")
  done < <(links_for_round "$round")
  "${PSQL[@]}" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
    -c "insert into participants (name, link) values $(IFS=,; echo "${vals[*]}");" >/dev/null
}

collisions=0
for round in $(seq 1 "$rounds"); do
  seed "$round"

  tmpdir="$(mktemp -d)"
  pids=()
  while IFS= read -r link; do
    (
      "${PSQL[@]}" -d "$PGDATABASE" -tAc "select 1 from draw('$link')" >/dev/null 2>"$tmpdir/err" \
        && echo OK >>"$tmpdir/results" \
        || { echo "FAIL" >>"$tmpdir/results"; cat "$tmpdir/err"; }
    ) &
    pids+=("$!")
  done < <(links_for_round "$round")

  for pid in "${pids[@]}"; do
    wait "$pid"
  done

  if grep -q "attributions_target_id_key" "$tmpdir/results"; then
    collisions=$((collisions + 1))
  fi
  rm -rf "$tmpdir"
done

"${PSQL[@]}" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -v rounds="$rounds" -v per_round="$per_round" \
  -v collisions="$collisions" -f - <<'SQL'
\set ON_ERROR_STOP on
\i :tests/lib/assertions.sql

select test_assert(
  (select count(distinct target_id) = count(*)
     from attributions a join participants g on g.id = a.giver_id
     where g.link::text between '10000000-0000-4000-8000-000000000000'
                            and '19000000-0000-4000-8000-000000000099'),
  'no two simultaneous draws share a target');

select test_assert(:collisions::int = 0, 'no draw failed with a target collision');

select test_assert(
  (select count(*)
     from attributions a join participants g on g.id = a.giver_id
     where g.link::text between '10000000-0000-4000-8000-000000000000'
                            and '19000000-0000-4000-8000-000000000099')
  + (select count(*)
     from participants p
     where p.link::text between '10000000-0000-4000-8000-000000000000'
                            and '19000000-0000-4000-8000-000000000099'
       and not exists (select 1 from attributions a where a.giver_id = p.id))
  = :rounds::int * :per_round::int,
  'each participant either drew or was left undrawn (solvability corner, ticket #5)');
SQL

echo "concurrency: $rounds rounds x $per_round simultaneous draws, zero target collisions."