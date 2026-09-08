#!/usr/bin/env bash
# Local Postgres test harness for the Secret Santa schema.
# Runs an ephemeral cluster on PGPORT with a stable PGDATA dir in /tmp.

set -euo pipefail

PGBIN="$(ls -d /opt/homebrew/Cellar/postgresql@16/*/bin | sort -V | tail -1)"
PGDATA="${PGDATA:-/tmp/ss_pgdata}"
PGPORT="${PGPORT:-55432}"
PGHOST="127.0.0.1"
PGUSER="postgres"
PGDATABASE="secret_santa_test"
PGBASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$PGBASE/migrations"
TESTS_DIR="$PGBASE/tests"
PSQL=("$PGBIN/psql" -X -q -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -v tests="$TESTS_DIR")

pg_ctl() {
  "$PGBIN/pg_ctl" "$@"
}

db_kill_port() {
  # Kill any stray postmaster still holding our port (e.g. from a crashed run).
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti "tcp:$PGPORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      kill $pids 2>/dev/null || true
      sleep 1
    fi
  fi
}

db_stop() {
  if [ -f "$PGDATA/PG_VERSION" ]; then
    pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  fi
}

db_init() {
  db_kill_port
  db_stop
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    "$PGBIN/initdb" -D "$PGDATA" -A trust -U "$PGUSER" >/dev/null
  fi
  pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" \
    -o "-p $PGPORT -h $PGHOST -k $PGDATA" start >/dev/null
}

db_setup_roles() {
  "${PSQL[@]}" -d postgres <<'SQL'
do $$
begin
  create role anon nologin nosuperuser noinherit;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role authenticated nologin nosuperuser noinherit;
exception when duplicate_object then null;
end $$;
grant usage on schema public to anon, authenticated;
SQL
}

db_reset() {
  "${PSQL[@]}" -d postgres -c "drop database if exists $PGDATABASE;" >/dev/null
  "${PSQL[@]}" -d postgres -c "create database $PGDATABASE;" >/dev/null
  db_setup_roles
}

db_apply_migrations() {
  for f in "$MIGRATIONS_DIR"/*.sql; do
    "${PSQL[@]}" -d "$PGDATABASE" -f "$f" >/dev/null
  done
}