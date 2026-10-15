#!/usr/bin/env bash
# Run as administrator on the selected Ubuntu ARM64 host, after quota review.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
[[ $ID == ubuntu && $(uname -m) == aarch64 ]] || { echo 'Ubuntu ARM64 required.' >&2; exit 1; }
# Never remove/replace an existing runtime or modify daemon/firewall/SSH settings.
if ! command -v docker >/dev/null; then
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      echo "Existing runtime package $package requires administrator review; nothing removed." >&2
      exit 1
    fi
  done
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
docker compose version
docker info >/dev/null
id sportos-deploy >/dev/null 2>&1 || useradd --user-group --create-home --shell /bin/bash sportos-deploy
usermod -aG docker sportos-deploy
install -d -m 700 -o sportos-deploy -g sportos-deploy /home/sportos-deploy/.ssh /opt/sportos-oracle /opt/sportos-oracle/releases
# Only the container UID needs access to source bytes.
install -d -m 700 -o 1000 -g 1000 /opt/sportos-oracle/uploads
echo 'Install the restricted deployment public key and protected API/worker env files. Docker group is root-equivalent.'
