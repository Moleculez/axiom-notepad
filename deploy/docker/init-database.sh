#!/bin/sh
set -eu
# Fresh volumes only. psql safely quotes the application password as a literal.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=app_password="$AXIOM_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE axiom LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE axiom OWNER axiom;
REVOKE ALL ON DATABASE axiom FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE axiom TO axiom;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname axiom <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO axiom;
SQL
