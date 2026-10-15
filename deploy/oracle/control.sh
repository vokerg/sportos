#!/usr/bin/env bash
set -euo pipefail
umask 077
root=${SPORTOS_DEPLOY_ROOT:-/opt/sportos-oracle}
cd "$root"
exec 9>operation.lock
flock -w 900 9
operation=${1:?operation required}
selection=${2:-all}
fail() { echo "$*" >&2; exit 1; }
compose() {
  local release_dir
  release_dir=$(readlink "$root/current")
  [[ $release_dir =~ ^releases/[0-9a-f]{40}$ ]] || fail 'Invalid saved release directory'
  # Resolve the symlink explicitly so ../../env and uploads stay under root.
  docker compose --env-file "$root/deployment.env" -p sportos-oracle -f "$root/$release_dir/compose.yml" "$@"
}
verify() {
  local service id state
  for service in "$@"; do
    id=$(compose ps -q "$service")
    [[ -n $id ]] || fail "$service has no running container"
    for ((attempt=1; attempt<=60; attempt++)); do
      state=$(docker inspect --format '{{.State.Health.Status}}' "$id")
      [[ $state != healthy ]] || break
      sleep 2
    done
    [[ $state == healthy ]] || fail "$service did not become healthy"
  done
}
case "$operation" in
  deploy)
    sha=${2:?SHA required}; web=${3:?web digest required}; api=${4:?api digest required}; worker=${5:?worker digest required}
    [[ $sha =~ ^[0-9a-f]{40}$ ]] || fail 'Full commit SHA required'
    for pair in "web:$web" "api:$api" "worker:$worker"; do
      service=${pair%%:*}; ref=${pair#*:}
      [[ $ref =~ ^ghcr\.io/vokerg/sportos-${service}@sha256:[0-9a-f]{64}$ ]] || fail 'Unexpected image digest'
    done
    [[ -f releases/$sha/compose.yml ]] || fail 'Release files missing'
    [[ -f api.env && -f worker.env ]] || fail 'Protected runtime env files missing'
    # Pull before changing the selected release. No migrations or registry secrets persisted.
    for ref in "$web" "$api" "$worker"; do docker pull "$ref"; done
    [[ ! -f deployment.env ]] || cp deployment.env previous.env
    printf 'RELEASE_SHA=%s\nWEB_IMAGE=%s\nAPI_IMAGE=%s\nWORKER_IMAGE=%s\n' "$sha" "$web" "$api" "$worker" > deployment.env.next
    mv deployment.env.next deployment.env
    ln -s "releases/$sha" current.next
    mv -Tf current.next current
    # Worker is deliberately excluded until #95. Never use unqualified compose up.
    compose up -d --no-deps --wait --wait-timeout 180 api
    compose up -d --no-deps --wait --wait-timeout 180 web
    verify api web
    printf '%s %s\n' "$(date -u +%FT%TZ)" "$sha" >> history.log
    ;;
  stop|start|restart)
    [[ -f deployment.env && -L current ]] || fail 'No saved deployment'
    case "$selection" in
      all) services=(api web); [[ $operation != stop ]] || services=(web api worker);;
      web) services=(web);;
      api) services=(api);;
      worker) [[ $operation == stop ]] || fail 'Worker blocked pending shared storage (#95)'; services=(worker);;
      *) fail 'Choose all, web, api or worker';;
    esac
    if [[ $operation == stop ]]; then
      compose --profile worker-blocked stop "${services[@]}"
    elif [[ $operation == start ]]; then
      compose start "${services[@]}"
      verify "${services[@]}"
    else
      compose restart "${services[@]}"
      verify "${services[@]}"
    fi
    ;;
  *) fail 'Choose deploy, stop, start or restart';;
esac
