#!/usr/bin/env bash
# Installs this checkout on a prepared Ubuntu 24.04 host. No database is dropped,
# no firewall is changed, and existing application installations are refused.
set -euo pipefail
if [[ $(uname -s) != Linux || $EUID -ne 0 ]]; then
  echo 'Run as root on the prepared Linux server.' >&2
  exit 1
fi
for axiom_command in node npm rsync systemctl caddy psql; do
  command -v "$axiom_command" >/dev/null || { echo "Missing prerequisite: $axiom_command" >&2; exit 1; }
done
node -e 'if(Number(process.versions.node.split(".")[0]) < 24) process.exit(1)' || { echo 'Install Node.js 24 LTS system-wide first.' >&2; exit 1; }
[[ -f /etc/axiom/axiom.env ]] || { echo 'Prepare /etc/axiom/axiom.env first; see deployment guide.' >&2; exit 1; }
[[ ! -e /opt/axiom ]] || { echo '/opt/axiom already exists. Use the documented upgrade procedure.' >&2; exit 1; }
axiom_source=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
[[ -f "$axiom_source/packages/shared/src/migrations.ts" ]] || exit 1
id axiom >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/axiom --shell /usr/sbin/nologin axiom
install -d -o axiom -g axiom -m 0750 /opt/axiom /var/lib/axiom /var/lib/axiom/attachments /var/lib/axiom/npm-cache
rsync -a --exclude node_modules --exclude .next --exclude .git --exclude '.env*' --exclude .local-db --exclude data --exclude backups --exclude test-results --exclude playwright-report "$axiom_source/" /opt/axiom/
chown -R axiom:axiom /opt/axiom
chown root:axiom /etc/axiom/axiom.env
chmod 0640 /etc/axiom/axiom.env
cd /opt/axiom
runuser -u axiom -- npm ci --cache /var/lib/axiom/npm-cache
runuser -u axiom -- node --import tsx scripts/ops/validate-env.ts /etc/axiom/axiom.env
runuser -u axiom -- node_modules/.bin/dotenv -e /etc/axiom/axiom.env -- node --import tsx scripts/ops/migrate.ts
runuser -u axiom -- node_modules/.bin/dotenv -e /etc/axiom/axiom.env -- npm run build
install -m 0644 deploy/native/axiom-web.service /etc/systemd/system/axiom-web.service
install -m 0644 deploy/native/axiom-sync.service /etc/systemd/system/axiom-sync.service
install -m 0644 deploy/native/axiom-worker.service /etc/systemd/system/axiom-worker.service
systemctl daemon-reload
systemctl enable --now axiom-sync axiom-worker axiom-web
echo 'Axiom services installed. Create the owner account and configure Caddy using docs/DEPLOYMENT.md.'
