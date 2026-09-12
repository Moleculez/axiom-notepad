# Docker Compose deployment and recovery

Primary target: one Linux host, Docker Engine with Compose v2, a DNS name, HTTPS,
PostgreSQL 16, Node 24 application image and persistent local file storage. This is
a controlled research-group beta. Read [verification and open gates](VERIFICATION.md).
The [native Linux/systemd path](NATIVE_DEPLOYMENT.md) remains available separately.

## First installation

1. Point DNS at the host. Allow inbound 80/443; restrict administration access.
   Keep database, application and internal sync ports private. Use encrypted disks.
2. Copy `.env.production.example` to `.env.production` and restrict it to mode 600.
   Set `APP_URL=https://your-host` (no trailing slash). Generate **four independent**
   secrets with `openssl rand -hex 32`: authentication, sync, PostgreSQL administrator
   and application database passwords. Hex avoids URL-escaping errors. Never commit
   real values or put credentials in public build arguments.
3. Review the configuration without printing interpolated secrets:

   ```sh
   docker compose --env-file .env.production config --quiet
   docker compose --env-file .env.production build db web
   docker compose --env-file .env.production up -d
   docker compose --env-file .env.production ps
   ```

4. Create the first owner inside the web container:

   ```sh
   docker compose --env-file .env.production exec web node --import tsx scripts/ops/admin.ts
   ```

5. Sign in, change the generated initial password, invite a colleague, and verify
   two-browser editing reaches “Saved on server.” Upload/preview/download a file,
   confirm an export job completes, and rehearse recovery before relying on it.

Never run development setup/seed/reset in production. The web-based one-time local
setup flow is disabled in production. Public account creation remains invitation-only.

Compose builds one runtime image shared by web/sync/worker/migrate. Migration must
finish before those services start; the proxy waits for web readiness. Fresh-volume
initialization creates a restricted `axiom` application role; PostgreSQL administrator
credentials are never passed to the application. Existing volumes are not rewritten.
Changing a password in the env file does not rotate an already-created database role.

Only Caddy publishes public ports. Sync additionally publishes
`127.0.0.1:1234:1234` for an existing host reverse proxy; set `AXIOM_SYNC_HOST_PORT`
if another local service occupies that port. `/sync` forwards WebSocket upgrades;
other internal sync endpoints cannot be reached through Caddy. The browser derives
a same-origin secure WebSocket URL; no localhost development URL is baked into production. SSE is flushed
without proxy buffering. Do not horizontally scale sync without shared room coordination.

## Existing host Nginx

If Nginx runs on the EC2/Linux host, Docker's internal `1234/tcp` exposure is not a
host listener. The loopback publication above makes `http://127.0.0.1:1234/health`
and the WebSocket upstream reachable from host Nginx. The sync process must still
listen on `0.0.0.0` **inside** its container; Compose already sets `SYNC_HOST` this way.
Do not change the published address to `0.0.0.0` or open port 1234 in the EC2 security
group. Use a current Docker Engine (28 or newer); older engines have a documented
[localhost publishing limitation](https://docs.docker.com/engine/network/port-publishing/).

Keep the existing Nginx TLS configuration and working web upstream. Use the
[sync location snippet](../deploy/nginx/sync.conf) inside the HTTPS `server` block,
replacing any existing `/sync` location rather than defining it twice. It proxies
only the exact `/sync` endpoint, forwards the HTTP/1.1 upgrade headers, and extends
idle timeouts for long-lived editing sessions. Do not forward `/internal/*` or the
whole public site to the sync service. If `AXIOM_SYNC_HOST_PORT` changes, update the
snippet's upstream port to match. See [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html).

For an already-running deployment, apply only the networking change:

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --no-deps --force-recreate sync
docker compose --env-file .env.production ps sync
docker compose --env-file .env.production port sync 1234
curl --fail http://127.0.0.1:1234/health
sudo nginx -t && sudo systemctl reload nginx
```

With the default port, `ps` should show `127.0.0.1:1234->1234/tcp`, `port` should
report `127.0.0.1:1234`, and the health response should identify service `sync` with
status `ok`. Recreating sync briefly disconnects editors; let pending edits reach
the server first and verify they reconnect afterward. A container **restart** alone
does not apply a changed port binding, and no application rebuild is needed here.

Keep using the same Compose project, env file and any deployment overrides so the
existing volumes and credentials are reused. Do not run the bundled `proxy` on
80/443 while host Nginx owns those ports; start only the intended services for that
deployment. Container-based proxies can continue using the internal `sync:1234`
address. In the browser, confirm `/sync` receives `101 Switching Protocols`, then
verify two-browser edits and “Saved on server”; a health response/upgrade alone
does not verify document authorization or durable collaboration.

## Configuration, health and logs

The startup entrypoint validates production origin, separate secrets, database URL,
absolute storage path and complete optional integrations without logging their values.
Containers receive an explicit environment allowlist, not the checkout's `.env`.

```sh
docker compose --env-file .env.production logs --tail 100 web sync worker migrate
docker compose --env-file .env.production exec web node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})"
docker compose --env-file .env.production exec sync node -e "fetch('http://127.0.0.1:1234/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})"
```

Health endpoints prove database availability, not job progress, storage capacity or
provider delivery. Monitor failed/queued jobs, expired leases, disk space, service
restarts, HTTP failures and backup age. Web/sync get a graceful shutdown window and
worker gets five minutes to drain its job. Protect logs; do not log cookies, invitation
tokens, request bodies or authentication payloads.

## Backups and recovery

The operations image contains matching PostgreSQL 16 client tools. The backup command
uses one exported database snapshot plus checksummed immutable blobs and a cleanup
lock. Backups include private research and account data; encrypt them off-host and
retain the deployment configuration/secrets separately. Device-only offline edits
are not included in a server backup.

Prepare `AXIOM_BACKUP_PATH` on the host with write access for container UID 1000.
On Linux, for a new dedicated directory only: `install -d -m 700 -o 1000 -g 1000 backups`.
Choose a new destination for each backup; the command refuses an existing target.

```sh
docker compose --env-file .env.production --profile operations build operations
docker compose --env-file .env.production run --rm operations node --import tsx scripts/ops/backup.ts create /backups/before-upgrade
docker compose --env-file .env.production run --rm operations node --import tsx scripts/ops/backup.ts verify /backups/before-upgrade
```

Schedule backups with the host scheduler and alert on failures. A partial directory
without its completed manifest is not a verified backup. Do not silently delete old
backups to resolve disk pressure.

Restore only a trusted backup to a **new empty database and empty storage path**.
Have the database administrator create `axiom_recovered` owned by `axiom`; do not
grant the application CREATEDB. Keep original services/data unchanged during rehearsal.

```sh
# Set RESTORE_DATABASE_URL privately to the new database; never the live database.
docker compose --env-file .env.production run --rm -e RESTORE_DATABASE_URL \
  -e STORAGE_PATH=/restore/attachments operations \
  node --import tsx scripts/ops/backup.ts restore /backups/before-upgrade
```

The `restore` named volume is separate from live attachments. Restore refuses the
current database, nonempty database/storage and checksum mismatches. Incomplete upload
staging is not backed up; only those incomplete sessions/jobs are cancelled in the
restored dataset. Completed files remain intact. Verify content, permissions, history
and file checksums against the restored copy before changing live configuration.
Actual recovery needs a reviewed Compose override changing **both** the database URL
and attachment volume; do not point the live stack at half of a recovered pair.

## Upgrade discipline

Preserve the previous image by an explicit release tag/digest and rehearse forward
migrations against a restored copy. Back up the current database/files, then stop web,
drain worker/sync, leave PostgreSQL running, build the candidate and run migration
before restarting services. Never overwrite the only known-good image tag before
acceptance. Preserve old client assets or coordinate a reload of old browser sessions.

No migration rollback is implied by an editor rollback. An older UI must be compatible
with the current schema; never restore an older database simply to undo a UI change
and discard newer research. Never run `docker compose down -v` on data you intend to
keep. Upgrade PostgreSQL major versions only through a tested database-upgrade process.

## Isolated deployment rehearsal

With Docker available and localhost ports 8181/8443 free, run:

```sh
npm run test:deployment
```

The runner creates a uniquely named Compose project, fresh databases/volumes and
private mode-600 configuration under `data/deployment-rehearsal-*`. It does not load
the development `.env`. Caddy uses its local certificate authority; only the isolated
browser test accepts that certificate. Your operating system trust store is unchanged.

The checks cover initial setup, invitation/join, collaborative editing, files, Canvas,
Trash, background export, service restart and backup/restore. The runner uses an
automatically allocated host-loopback sync port and verifies its health, so it does
not compete with a development service on 1234. Recovery uses a second
empty database and storage volume, then checks canonical content and every blob hash.
Receipts record the project name and result; screenshots/traces are retained under
`test-results/deployment-current/{workflow,restart}`. A failed run retains its resources
for inspection. This tests the container workflow, not public DNS or external providers.

The runner leaves its services and volumes available for inspection. After review,
stop only that project's containers, substituting the exact project and private
configuration path printed by the runner:

```sh
docker compose --project-name REHEARSAL_PROJECT \
  --env-file data/deployment-rehearsal-XXXXXX/compose.env \
  -f compose.yaml -f deploy/docker/compose.rehearsal.yaml down
```

Do not add `-v`: the test databases, backups and restored files remain available.
Rehearsal images/volumes are not selected by `clean:generated`; review them explicitly
before any separate Docker cleanup, and never use a global prune on a shared host.

## Optional integrations

- SMTP: configure `SMTP_URL` and `MAIL_FROM`; test real invitation/recovery delivery.
  Copyable, email-bound invitation links work without SMTP. The admin CLI can issue
  a one-hour recovery link using `--recover --email person@example.org`; treat it as
  a password.
- OIDC: configure discovery URL/client ID/secret together. Register
  `https://YOUR-ORIGIN/api/auth/callback/institution`. Existing users explicitly link
  a same-email verified identity. Local mock checks do not certify a real institution.
  Password MFA and upstream OIDC MFA are distinct policies.
- Office conversion: enable the `research-tools` profile, configure its private URL
  and independent token, then test DOCX/PPTX conversion. The isolated converter has no
  published port. AI/OCR providers require explicit administrator configuration and
  user submission; they are disabled by default.
- S3: the shipped Compose profile uses local storage. A reviewed environment override
  can select private S3 for all application/operations services. Changing drivers does
  not migrate files. Test uploads, ranges, checksums, cleanup and recovery on the actual
  storage provider before migration; see [storage requirements](NATIVE_DEPLOYMENT.md#storage).

The legacy import limit is 50 MiB by default; Explorer allows files up to 1,000,000,000
bytes in resumable 8 MiB requests. The proxy limit is per request, not per complete file.
Physical disk usage includes staged uploads, previews/exports and backups in addition
to logical quotas. No cloud deployment or external integration certification is implied.
