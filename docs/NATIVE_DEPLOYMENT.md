# Native Linux deployment (secondary path)

The primary deployment path is [Docker Compose](DEPLOYMENT.md). This guide describes
the separately maintained native option; it has not been rehearsed on a Linux host
in the current release-preparation run.

## Native AWS installation

Target: a single Ubuntu 24.04 LTS EC2 instance with Node.js 24 LTS installed system-wide, PostgreSQL 16, Caddy 2, npm, and rsync. Start with 2–4 vCPUs and 4–8 GB RAM, then measure your workload. Run a web process, **one** sync process and a workspace worker. Do not horizontally scale sync without shared room coordination. The worker completes uploads/exports, generates previews and schedules research notifications.

1. Point a DNS name at the instance. Allow inbound HTTPS (443), HTTP (80 for certificate issuance/redirect), and SSH only from your administration network. Keep ports 3000, 1234, and 5432 private. Use encrypted EBS and an IAM instance role instead of long-lived AWS keys.
2. Install the prerequisites. Use the [official Node.js distribution](https://nodejs.org/en/download) and [Caddy installation guide](https://caddyserver.com/docs/install). On Ubuntu, PostgreSQL 16 and rsync are available through apt. Make `node` accessible at `/usr/bin/node` or `/usr/local/bin/node`; a personal nvm installation is not accessible to the locked-down service account.
3. Create a database and a non-superuser application role. Use `sudo -u postgres psql`, then `CREATE ROLE axiom LOGIN;`, `\password axiom`, and `CREATE DATABASE axiom OWNER axiom;`. Do not put a real password into shell history. Grant only access to this database.
4. Prepare `/etc/axiom/axiom.env` from `deploy/native/axiom.env.example`. Set the database URL, real HTTPS origin, and two different secrets generated with `openssl rand -hex 32`. URL-encode reserved characters in database/SMTP passwords. Keep `NEXT_PUBLIC_SYNC_URL` blank for the same-origin `/sync` route. The example attachment path is `/var/lib/axiom/attachments`.
5. From this checkout, run `sudo bash deploy/native/install.sh`. It refuses an existing `/opt/axiom`, validates configuration, installs dependencies, migrates, builds, and installs all three systemd services. It does not create or overwrite a database, alter your firewall, or replace your Caddy configuration.
6. Create the first group owner:

   ```sh
   cd /opt/axiom
   sudo -u axiom node_modules/.bin/dotenv -e /etc/axiom/axiom.env -- node --import tsx scripts/ops/admin.ts
   ```

7. Edit `deploy/native/Caddyfile` with the real DNS name. Merge it with your existing Caddy configuration if this host serves other applications. Validate with `sudo caddy validate --config /etc/caddy/Caddyfile`, then reload Caddy. Its reverse proxy supports [WebSocket upgrades](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and enforces a [request-body limit](https://caddyserver.com/docs/caddyfile/directives/request_body).
8. Sign in, change the initial password, invite a colleague, and confirm a two-browser edit reaches “Saved on server.” Upload a small PDF and test a snapshot restore before relying on the installation.

### Health and logs

```sh
curl --fail http://127.0.0.1:3000/api/v1/health
curl --fail http://127.0.0.1:1234/health
sudo systemctl status axiom-web axiom-sync axiom-worker
sudo journalctl -u axiom-web -u axiom-sync -u axiom-worker --since '10 minutes ago'
```

Health endpoints check database connectivity, not every storage/SMTP dependency. Monitor disk space, PostgreSQL availability, HTTP failures, and backup freshness. Restrict access to logs, which can contain note IDs and account-related diagnostics. Do not configure proxy logs to capture invitation query strings, authentication payloads, or cookies.

Also monitor queued/failed `workspace_jobs` and expired leases. A healthy web server alone does not prove file verification/export processing is running. Worker shutdown drains its current job; systemd allows five minutes. Do not force-kill an in-progress export during an upgrade. Proxy `/api/v1/events` without response buffering; Caddy's [streaming behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming) flushes event-stream responses promptly.

### Email and account recovery

SMTP is optional: invitations always return a copyable, seven-day, email-bound link. Set `SMTP_URL` and `MAIL_FROM` to enable invitations and recovery emails. Delivery failure does not consume an invitation. Test actual delivery and spam handling with your provider.

Without SMTP, an administrator with shell access can issue a one-hour recovery link:

```sh
sudo -u axiom node_modules/.bin/dotenv -e /etc/axiom/axiom.env -- node --import tsx scripts/ops/admin.ts --recover --email researcher@example.org
```

Treat the displayed link as a password. Resetting a password revokes existing sessions.

### Institutional identity and MFA

Configure all of `OIDC_DISCOVERY_URL` (HTTPS), `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`; `OIDC_DISPLAY_NAME` is optional. Register **`https://YOUR-ORIGIN/api/auth/callback/institution`** with the provider and permit `openid profile email`. Restart the web and worker processes after changing identity configuration. Store secrets outside source control.

Existing invited users link their institution explicitly in Account security. The verified provider email must match the local account. PKCE, signed ID-token validation, issuer/audience and nonce checks are required; unknown users and implicit linking are refused. Linking never grants group/project membership. Keep password login available during rollout, test with a real institutional account and test revocation/recovery before relying on it. The local mock-provider verifier does not certify any real university provider.

Authenticator TOTP and recovery codes protect **password sign-in**. Institutional login follows the upstream provider's MFA policy; configure that policy at the institution. `OIDC_LOCAL_TEST` is rejected in production and must never be deployed. A linked provider logout does not remotely erase offline research.

### Storage

Local storage is the simplest single-server installation. Files are immutable blobs outside the public directory; downloads and previews check the current resource-space role, including account-owned personal spaces. Database backups alone are insufficient. The web and worker must share the same `STORAGE_PATH` and storage-driver configuration.

For S3, set `STORAGE_DRIVER=s3`, `S3_BUCKET`, and `AWS_REGION`. Optional `S3_ENDPOINT` enables a compatible private endpoint with path-style requests. Use a private bucket with Block Public Access, encryption and versioning. Grant object read/write, multipart upload/abort and deletion capabilities only for the application's storage destination. Deletion supports explicit file cleanup, cancelled incomplete transfers and failed import/export rollback. Never expose the bucket as a public asset origin. Test streaming, ranges, checksums, resumable parts, conditional writes, cleanup and restoration in the actual bucket before migrating; changing drivers does not copy files.

Explorer's limit is 1,000,000,000 bytes per file, transferred in 8 MiB requests. `MAX_UPLOAD_MB` continues to govern the legacy import/attachment endpoint, not the Explorer limit. The example proxy's 55 MB per-request limit permits both. Allow sufficient request/response duration for exports and downloads. Local uploads reserve disk headroom for staged and assembled copies. Logical group quotas include all file versions, trash and unexpired upload reservations; avatars/previews/exports add physical disk usage outside those totals. Monitor actual disk/bucket capacity as well.

Completed originals/versions have no automatic retention expiry. Manual cleanup refuses live/snapshot links, annotations and reading/reference usage, then queues exact unreferenced-blob deletion after commit. Incomplete transfers expire after seven days. Do not enable a bucket lifecycle policy that deletes still-referenced blobs. Choose backup retention independently.

## Backup and restore

PostgreSQL client tools must be at least as new as the server. Use `PG_BIN=/path/to/postgresql/bin` if they are not on PATH. The tool uses [`pg_dump` custom archives](https://www.postgresql.org/docs/16/app-pgdump.html) and streamed immutable blobs with SHA-256 checksums. The dump and inventory share an exported database snapshot; a backup lock protects blobs against concurrent manual cleanup. Shared blobs are copied once, including avatars, derivatives and prepared exports. Both older v1 and current v2 backup manifests can be verified/restored. Pending journaled CRDT updates are included; disconnected-device-only edits are not server backups.

```sh
cd /opt/axiom
node_modules/.bin/dotenv -e /etc/axiom/axiom.env -- npm run backup -- create /var/lib/axiom/backups/2026-09-08
npm run backup -- verify /var/lib/axiom/backups/2026-09-08
```

Create the parent backup directory first. A backup destination must not already exist. A failed run can leave an incomplete directory without a manifest; it is not a valid backup. Keep the application secrets/configuration separately in your encrypted secret store. Backups contain password hashes, sessions, and private research: encrypt them before off-host storage, restrict access, and implement your retention policy. Schedule the command with your existing system scheduler and alert on a nonzero exit; the application does not silently delete old backups.

Restore only a trusted backup; a PostgreSQL dump can execute SQL. Create a **new, empty** database and a new attachment destination, stop the application, then:

```sh
RESTORE_DATABASE_URL='postgresql://axiom:encoded-password@127.0.0.1:5432/axiom_recovered' \
STORAGE_PATH=/var/lib/axiom/recovered-attachments \
node_modules/.bin/dotenv -e /etc/axiom/axiom.env -- npm run backup -- restore /var/lib/axiom/backups/2026-09-08
```

Restore refuses the current database, a nonempty target database, and a nonempty local attachment destination. Checksums are verified before restoration. Multipart staging is not backed up: incomplete sessions/jobs are cancelled in the restored database only, and users must upload those originals again. Existing completed files remain intact; restore does not abort uploads in the source installation's S3 bucket. On failure, keep the original unchanged; never start against a partial restore. On success, update `DATABASE_URL` and `STORAGE_PATH` together, apply forward migrations, start sync/worker/web, and verify accounts, permissions, note/history content and files. Practice recovery periodically.

## Upgrades

Rehearse migrations against a restored copy first. Back up the live database/blob pair and preserve its matching code/build. Stop web, let the worker finish, and gracefully drain sync; leave PostgreSQL running. Preserve configuration and data. Install locked dependencies, run migrations and build with the production environment. Start sync, worker and web, then verify existing private/shared content, permissions, file checksums, preferences and editor saves. Keep the previous release/backup until acceptance. Public sync URLs are build-time values; never deploy a test-origin build. Do not restore an older database merely to undo a UI change or discard post-release user writes.

The baseline plus numbered forward migrations are idempotent. Workspace migrations 4–7 preserve note identities, CRDT generations/state, snapshots, attachments and preferences while adding resource ownership/access, projects, accounts, jobs and file usage. Never run an old pre-workspace sync binary against the upgraded schema. New releases must add forward migrations rather than rewrite an applied migration.

Search uses PostgreSQL's `pg_trgm` extension and a GIN title index. Install the PostgreSQL contribution extensions for your distribution if unavailable. The database owner can install this trusted extension; if your hosting policy forbids application-managed extensions, have the database administrator run `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the application database before migration.

## Docker alternative

Use the [current Compose guide](DEPLOYMENT.md), not the older development `.env`
or native commands above. No AWS/cloud deployment is implied by either guide.
