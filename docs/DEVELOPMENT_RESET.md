# Main development reset and first run

`npm run reset:development` is a **dry run**. Execution requires
`npm run reset:development -- --confirm-main-development-purge` after stopping the
main web/sync/worker services. Never run it against a production deployment.

The command accepts only database `axiom` on loopback port `54329`, with local
storage at this repository's exact `data/attachments` real path. It refuses other
databases, symlinks, S3, remote servers, production mode and open application DB
connections. It creates and verifies a fresh checksum backup before touching data.
`PG_BIN` can point to the installed PostgreSQL tool directory for `pg_dump`.

The public schema is rebuilt transactionally using the same numbered migration
runner as normal upgrades. The entire old attachment directory is moved into the
new backup as `retired-development-storage`, not recursively deleted. This also
preserves orphaned files and incomplete upload parts. A migration/storage failure
before commit rolls back the database and restores the directory. Existing backup
directories, test databases/storage, source files, `.env`, and the PostgreSQL
cluster are outside the reset scope.

After reset, `data/development-setup-token.txt` contains a random, one-time token
with owner-only file permissions. The DB stores only its SHA-256 hash. Restart dev
services (`npm run dev`) on port 8080 and enter that token in the first-run screen.
Choose an owner name/email/password and an empty group name. No demo account or
content is seeded. Normal sign-in follows completion.

Setup is disabled in production, on non-loopback deployments, with
`AXIOM_DEV_SETUP=0`, without a token, or once completed. It uses Better Auth's
account/password implementation. A database advisory lock serializes concurrent
setup attempts. The account-creation intent is recorded before calling auth; a
crash after account creation can resume only with the original email, one-time
token and account password. Group creation, ownership and token consumption commit
together. Existing unrelated accounts cannot be claimed by setup.

## Dataset boundary

Every initialized database gets an independent `app_instance.dataset_id`.
`GET /api/v1/instance` is public, uncached and contains no account information.
The client verifies it before mounting account views and before offline replay.
Normal API requests identify their verified dataset; mismatches are rejected.

After a development replacement, account views unmount, offline replay stops, and
only Axiom-prefixed local/session storage, IndexedDB journals/packages and shell
caches are removed on that origin. The browser signs out and returns to first run.
Other tabs receive storage/reset signals; blocked databases ask you to close those
tabs and retry. A pending-reset marker prevents a reload from bypassing cleanup.
Offline use remains available for a previously verified dataset, but a browser
cannot initialize an unknown dataset while offline.

This is intentionally different from ordinary sign-out or permission loss, which
retain their existing draft recovery contracts. The destructive cache clearing is
specific to replacing a development dataset.

## Recovery

The reset prints the exact backup directory and records `reset-receipt.json` there.
Use `npm run backup -- verify <absolute-directory>` before recovery. Restore into
a **new empty database and storage directory**, as required by the backup tool;
do not overwrite a running installation. Point stopped services at the restored
pair only after checking it. Treat backups and setup tokens as private credentials.

Current isolated Canvas verification uses `scripts/run-canvas-staging.ts`, database
`axiom_canvas_v1_test_20260911`, port 3004, sync 1236, and its own attachment folder.
The old port-3002 staging dataset remains separate and is not reset.
