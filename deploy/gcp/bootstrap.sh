#!/usr/bin/env bash
# Explicit one-time operator action, never called by CI.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run bootstrap as root' >&2; exit 1; }
login=${1:?Usage: bootstrap.sh OS_LOGIN_LINUX_USERNAME}
[[ $login =~ ^[a-z_][a-z0-9_-]*\$?$ ]] || exit 2
getent passwd "$login" >/dev/null
[[ $(node -p 'process.versions.node.split(".")[0]') == 22 ]]
[[ $(command -v node) == /usr/bin/node ]]
python3 -c 'import sys; assert sys.version_info[:2] == (3, 13)'
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
getent group sportos-deploy >/dev/null || groupadd --system sportos-deploy
id sportos-worker >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/sportos --shell /usr/sbin/nologin sportos-worker
usermod -aG sportos-deploy "$login"
# Root owns the parent; deployment group may manage only releases/current links.
install -d -o root -g sportos-deploy -m 2775 /opt/sportos
install -d -o root -g sportos-deploy -m 2771 /opt/sportos/releases
install -d -o root -g sportos-deploy -m 2770 /opt/sportos/incoming
install -d -o root -g root -m 0755 /etc/sportos
install -d -o sportos-worker -g sportos-worker -m 0700 /var/lib/sportos /var/lib/sportos/uploads
install -o root -g root -m 0755 "$source_dir/control.sh" /usr/local/sbin/sportos-worker-control
install -o root -g root -m 0755 "$source_dir/deploy.sh" /usr/local/bin/sportos-worker-deploy
install -o root -g root -m 0644 "$source_dir/sportos-worker.service" /etc/systemd/system/sportos-worker.service
sudoers=$(mktemp)
trap 'rm -f "$sudoers"' EXIT
for action in start stop restart status verify; do
  printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/sportos-worker-control %s\n' "$login" "$action" >> "$sudoers"
done
visudo -cf "$sudoers"
install -o root -g root -m 0440 "$sudoers" /etc/sudoers.d/sportos-worker
if [[ ! -f /etc/sportos/worker.env ]]; then
  install -o root -g root -m 0600 "$source_dir/worker.env.example" /etc/sportos/worker.env
fi
# Bound the existing VM journal; this is a host-wide limit, not log forwarding.
install -d -m 0755 /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=100M\nRuntimeMaxUse=30M\nMaxRetentionSec=7day\n' > /etc/systemd/journald.conf.d/60-sportos-storage.conf
systemctl restart systemd-journald
systemctl daemon-reload
systemctl enable sportos-worker.service
# enable only: no release exists and no worker is started here.
echo 'Installed; configure worker.env and resolve storage/egress before deploying. Reconnect the OS Login user to pick up group membership.'
