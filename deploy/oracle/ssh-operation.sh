#!/usr/bin/env bash
# Runner-side transport. SSH secrets are supplied as environment, never arguments.
set -euo pipefail
umask 077
operation=${1:?operation}; service=${2:-all}
[[ $operation =~ ^(deploy|start|stop|restart)$ && $service =~ ^(all|api|web|worker)$ ]] || exit 1
[[ $ORACLE_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && $ORACLE_USER =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 1
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
printf '%s\n' "$ORACLE_SSH_KEY" > "$scratch/key"
printf '%s\n' "$ORACLE_SSH_HOST_KEY" > "$scratch/known_hosts"
mkdir "$scratch/bundle"
printf '%s\n' "$operation" > "$scratch/bundle/operation"
if [[ $operation == deploy ]]; then
  printf '%s\n' "$RELEASE_SHA" "$WEB_IMAGE" "$API_IMAGE" "$WORKER_IMAGE" > "$scratch/bundle/manifest"
  printf '%s' "$GHCR_TOKEN" > "$scratch/bundle/registry-token"
  printf '%s' "$GHCR_USER" > "$scratch/bundle/registry-user"
  cp deploy/docker/compose.yml deploy/oracle/control.sh "$scratch/bundle/"
else
  printf '%s\n' "$service" > "$scratch/bundle/service"
fi
remote_script=$(cat deploy/oracle/remote.sh)
# remote.sh contains no single quotes so it can be passed as one SSH shell argument.
[[ $remote_script != *"'"* ]] || { echo 'remote.sh must contain no single quotes' >&2; exit 1; }
tar -C "$scratch/bundle" -cf - . | ssh -i "$scratch/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$scratch/known_hosts" -o ConnectTimeout=20 "$ORACLE_USER@$ORACLE_HOST" "bash -c '$remote_script'"
