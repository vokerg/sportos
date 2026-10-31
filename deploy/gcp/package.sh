#!/usr/bin/env bash
# Run on a Linux x86_64 runner with Node 22, pnpm 9 and Python 3.13.
set -euo pipefail
output=${1:?Usage: package.sh OUTPUT_DIRECTORY}
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]]
[[ $(node -p 'process.versions.node.split(".")[0]') == 22 ]]
python3 -c 'import sys; assert sys.version_info[:2] == (3, 13)'
mkdir -p "$output"
output=$(realpath "$output")
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
pnpm --filter @sportos/worker build
pnpm --filter @sportos/worker deploy --prod "$stage/apps/worker"
# Preserve the monorepo-relative helper paths used by the built worker.
mkdir -p "$stage/tools/garmin" "$stage/wheels"
cp tools/garmin/*.py tools/garmin/requirements.txt "$stage/tools/garmin/"
# Never compile Python dependencies on the VM. Fail if no compatible wheel exists.
python3 -m pip download --only-binary=:all: --dest "$stage/wheels" -r tools/garmin/requirements.txt
# pnpm deploy respects package ignore rules; additionally reject accidental config.
if find "$stage" -name '.env' -o -name '.env.*' -o -name 'gha-creds-*.json' | grep -q .; then
  echo 'Unexpected private configuration in release' >&2; exit 1
fi
(cd "$stage/apps/worker" && node --input-type=module -e "await Promise.all([import('@sportos/db'), import('@sportos/importers'), import('@sportos/garmin-runtime')])")
git rev-parse HEAD > "$stage/REVISION"
tar -czf "$output/worker.tar.gz" -C "$stage" .
(cd "$output" && sha256sum worker.tar.gz > worker.tar.gz.sha256)
