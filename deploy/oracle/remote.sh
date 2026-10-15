#!/usr/bin/env bash
# Executes on Ubuntu, with a tar bundle on stdin. Called by ssh-operation.sh.
set -euo pipefail
umask 077
cd /opt/sportos-oracle
incoming=$(mktemp -d .incoming.XXXXXX)
trap 'rm -rf "$incoming"' EXIT
# Bundle is created exclusively from allowlisted files by the workflow runner.
tar -xf - -C "$incoming"
export DOCKER_CONFIG="$PWD/$incoming/docker"
mkdir -m 700 "$DOCKER_CONFIG"
read -r operation < "$incoming/operation"
if [[ $operation == deploy ]]; then
  mapfile -t release < "$incoming/manifest"
  sha=${release[0]}
  [[ $sha =~ ^[0-9a-f]{40}$ && ${#release[@]} == 4 ]] || exit 1
  docker login ghcr.io -u "$(cat "$incoming/registry-user")" --password-stdin < "$incoming/registry-token" >/dev/null
  rm "$incoming/registry-token"
  # Release contents are immutable on this host. Retrying a SHA reuses its files.
  mkdir -p releases
  if [[ ! -e releases/$sha ]]; then
    mkdir "$incoming/release"
    mv "$incoming/compose.yml" "$incoming/control.sh" "$incoming/release/"
    mv "$incoming/release" "releases/$sha"
  fi
  bash "releases/$sha/control.sh" deploy "${release[@]}"
else
  read -r service < "$incoming/service"
  [[ $operation =~ ^(start|stop|restart)$ && $service =~ ^(all|api|web|worker)$ ]] || exit 1
  bash current/control.sh "$operation" "$service"
fi
