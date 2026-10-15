# Oracle manual deployment (#147)

Repository-side preparation for a parallel Ubuntu ARM64 host. Vercel, Render,
DNS and both Neon projects remain unchanged. Nothing here provisions a paid
resource or runs migrations. **No Oracle server has been deployed or verified.**

## Capacity and host setup

First inspect existing OCI instances, home region, boot/block volumes and free
allocation in the Console. Stockholm A1 capacity was unavailable when #147 was
opened. Use only a shape/image explicitly marked **Always Free Eligible**.
[Oracle's current allowance](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
is 1,500 A1 OCPU-hours and 9,000 GB-hours monthly (2 OCPUs / 12 GB total), with
200 GB aggregate boot/block storage in the home region. Recheck current limits
and account usage before creation; old 4 OCPU / 24 GB instructions differ.
Do not upgrade the account, consume credits on other shapes or automate capacity
retries. Suggested host: Ubuntu 24.04 ARM64, A1 Flex, at most 2 OCPUs / 12 GB,
50 GB boot volume, reduced as needed for other tenancy resources.

After the server exists, verify `uname -m` (`aarch64`), `/etc/os-release`, RAM,
disk, existing services and ports. Copy and review `deploy/oracle/bootstrap.sh`,
then run it as administrator. It installs Docker Engine/Compose from Docker's
signed Ubuntu repository if absent, creates `sportos-deploy` and the private
`/opt/sportos-oracle` tree, and leaves existing runtimes/settings alone. It does
not change firewall, SSH, daemon configuration or other applications. Docker's
installation can create its normal networking rules; review these against host
policy. The Docker group gives root-equivalent access; protect this account.

Keep the administrator key separate. Generate a dedicated Ed25519 deployment
key and install only its public key in
`/home/sportos-deploy/.ssh/authorized_keys`, owner `sportos-deploy`, mode 600,
prefixed with `restrict` (no forwarding, PTY or agent forwarding). Disable root
and password SSH after confirming administrator access. Restrict OCI ingress
and the host firewall to SSH from controlled administrator/runner egress.
GitHub-hosted runners have changing addresses; use a runner with fixed egress
or reviewed private connectivity if a narrow allowlist is required. Do not open
SSH globally just to get Actions working. Never expose Docker Engine TCP.

Compose publishes only `127.0.0.1:8080`. Inspect availability of that port before
launch. Keep the host general purpose; independent workers use their own Compose
projects, ports and budgets. No global Docker prune or host resource takeover.

## Runtime configuration and storage blocker

Copy `deploy/docker/api.env.example` and `worker.env.example` privately to
`/opt/sportos-oracle/api.env` and `worker.env`, owner `sportos-deploy`, mode 600.
Compose requires both files, but currently starts **only API and web**.
API gets only its API-role URLs; worker gets dispatcher and worker-data URLs.
Never put migration-owner or legacy URLs in either file. Each runtime uses its
existing non-owner role, primary project and separately configured detail project.
Budget Neon connections across Render, local processes and Oracle.

Retain existing provider encryption key IDs and values exactly. Keep optional
AI generation disabled unless intentionally configured. Hosted Garmin helper
fetch stays disabled. Copy the existing single-user password hash, or configure
OIDC according to `.env.example` and `docs/AUTHENTICATION.md`; never use
`dev-single-user` or a development auth token in production.

**#95 remains deferred and is not implemented here.** Only LocalUploadStorage is
implemented. Oracle's `/uploads` bind mount survives container replacement but
is neither shared with Render nor sufficient for recoverability. Do not submit
uploads or start import/provider/rule processing as part of this deployment.
The worker service has an explicit failure entrypoint and a disabled-by-default
profile; Start/Restart worker also refuses. `all` starts/restarts API/web only;
Stop all also stops a worker container if one exists. The worker image contains
the real worker process for subsequent shared-storage implementation/testing.
Do not remove the guard just because the image builds.

Before enabling the worker, #95 must supply a durable shared storage backend to
both Render and Oracle, migrate/backfill retained objects with unchanged opaque
keys/provider semantics, validate existing and newly uploaded originals from
either API, and prove backup/restore. A private Oracle directory is insufficient.
Check old queued jobs whose Render originals may already be lost before retrying.
Never guess missing source bytes or mark such jobs successfully imported.

## Authentication and network access

Production API validation requires HTTPS origins and secure cookies. Loopback
HTTP through an SSH tunnel supports **liveness smoke tests only**; it is not an
authenticated deployment. Do not weaken production validation to log in.
For authenticated use, supply a separately reviewed HTTPS endpoint with TLS
termination/certificate renewal, OCI/host ingress restricted to required ports
and the upstream on loopback. Then set Oracle's own exact web/API origin and
Strava `/api/providers/strava/callback` URL, preserving existing Vercel/Render
settings. Verify provider callback-domain restrictions before attempting OAuth;
a shared Strava application's callback policy may prevent parallel hostnames.
For OIDC, add an allowed callback without removing the existing one.

Nginx serves the hosted Angular build, proxies `/api/` to the private API and
marks API responses private/no-store. Cookies, CSRF and redirects use the same
Oracle frontend origin. It does not change Vercel's API rewrite. Test sign-in,
session expiry, sign-out, unsafe-method CSRF rejection, detail-db reads and
approved OAuth callbacks on the HTTPS origin before calling this operational.

## Manual GitHub Actions

Both workflows use **workflow_dispatch only**. Existing CI/Render/Vercel rules
are unchanged. Workflows become available through the default branch after a
reviewed, explicitly authorized merge. Run trusted branches only: deployment
code has Docker/root-equivalent authority on the host.

1. **Oracle Build and Publish or Deploy**: native `ubuntu-24.04-arm` runner builds
   three images (`sportos-web`, `sportos-api`, `sportos-worker`) and publishes
   `ghcr.io/vokerg/<image>:<full-commit-SHA>`. Defaults to **publish only**, which
   requires no VM secrets. Refuses already published tags. Runtime import and
   web/proxy smoke checks run against ARM64 images without production credentials.
   Select `deploy=true` only after host/configuration preparation.
2. **Oracle Start Stop Restart or Rollback**: choose a lifecycle operation and
   service. Start uses existing containers/images, Restart restarts that selection,
   Stop preserves containers and honors intentional stops across host restarts
   through `unless-stopped`. Start web alone expects API already running; use all
   to start both. No unrelated worker is launched.
3. Rollback requires a full published commit SHA and explicit schema/job
   compatibility acknowledgment. It resolves all three images to digests and
   recreates API/web. It never reverses migrations. It can also deploy a published
   release after a previous SSH/deploy failure, without rebuilding.

The GitHub Environment **oracle** has been created with a custom deployment
branch policy allowing only `main`. Add reviewer protection if desired. Its SSH
secrets remain unset; set these environment secrets when the VM exists:

| Secret | Value |
|---|---|
| `ORACLE_HOST` | Hostname or IPv4, SSH port 22 |
| `ORACLE_USER` | `sportos-deploy` |
| `ORACLE_SSH_KEY` | Dedicated private deployment key |
| `ORACLE_SSH_HOST_KEY` | Complete trusted OpenSSH known_hosts entry |

Obtain the server public host key/fingerprint from OCI console or a trusted
administrator channel. `ssh-keyscan` alone does not prove trust. Strict checking
is enabled. No Oracle password or MFA is needed in Actions. Never log keys/env
files/resolved Compose configuration. Secrets have not been configured yet.

GHCR uses ephemeral GITHUB_TOKEN: build gets packages:write, deploy/rollback
packages:read, lifecycle contents:read only. Grant repository Actions access to
all three packages if needed. Registry credentials are mode-private temporary
files and removed remotely after the operation. Interrupted sessions may leave
`.incoming.*` directories; remove only after confirming no operation is running.
Tokens expire automatically. Package/tag deletion must not remove needed rollback
releases; deployments use digests, never mutable latest tags.

All operations share one GitHub concurrency group and host `flock`; active runs
are not cancelled. GitHub can replace older pending runs; avoid queuing several.
The host saves `deployment.env` (SHA/digests only), `previous.env`, `history.log`
and `releases/<SHA>`. Selection is saved before recreation, so an interrupted
operation is visible and retryable. There is no automatic rollback. Rollback to
an existing release reuses its stored Compose/control files; a newly selected
SHA uses files from the workflow ref. Review those files along with image/schema
compatibility. Partial image publication requires inspection: use another commit
for a new build rather than overwriting an existing SHA tag.

## Operations, limits and recovery

As administrator, use a separate key that permits forwarding:

```sh
ssh -L 8080:127.0.0.1:8080 ubuntu@VM_HOST
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/api/health
```

As `sportos-deploy` on the host:

```sh
cd /opt/sportos-oracle
bash current/control.sh stop all
bash current/control.sh start all
bash current/control.sh restart api
docker compose --env-file deployment.env -p sportos-oracle -f "$(readlink current)/compose.yml" ps --all
docker compose --env-file deployment.env -p sportos-oracle -f "$(readlink current)/compose.yml" logs --tail 100 api
```

Deploy waits for API/web health. `/api/health` is liveness only: it does not prove
Neon/schema/authentication readiness. The worker is intentionally not health
validated or running. After #95, validate real jobs, safe shutdown and lease
recovery against intended non-owner roles before enabling it. Existing runners
stop polling on SIGTERM/SIGINT, await active work and close pools; Compose allows
120 seconds before kill. Long work can exceed that window; expired leases can
recover, and immutable source/idempotency rules remain required. Do not run
local and hosted workers concurrently until mixed-version lease behavior and
external effects are reviewed; initially stop other workers first.

Initial limits: web 0.25 CPU/256 MiB, API 0.5 CPU/1.5 GiB, prepared worker
0.75 CPU/2 GiB; 128 processes each and three 10 MB log files each. These leave
headroom for other host work and are not measured capacity guarantees. Monitor
OOM/restarts, disk and latency. Images accumulate: retain selected/previous and
container-referenced images; remove only reviewed, unreferenced SportOS images
and old release directories. Never run global prune on this shared host.

Back up both Neon projects with compatible schema/state, the stable encryption
key ring, protected runtime configuration, uploaded original bytes with their
keys and hashes, and release SHA/digests to private off-host storage. A host
bind mount is not a backup. Exercise restore with owner-scoped reads before
trusting recovery. Until #95, source backup/shared restore remains a blocker.

For VM loss/reclamation: obtain eligible replacement capacity within aggregate
limits, bootstrap, restore private config/originals, install a new deploy key,
update host/key/verified-host-key secrets, and Rollback to a compatible published
SHA. No migrations or database restore are implied by VM replacement. Do not
manufacture traffic to defeat Oracle idle reclamation.

For schema changes: stop Oracle and other workers; review compatibility with
both existing Render and Oracle versions/queued jobs; back up; run primary and
activity-detail Flyway separately once with explicitly authorized migration-only
credentials; then deploy compatible code and validate. Breaking changes may
require stopping all APIs first. Prefer expand/contract while versions coexist.
No startup/deployment command invokes Flyway, and image rollback cannot reverse
database state. Render's documented build command also has no migration step.

## Investigation and validation status

Inspected files are recorded in [implementation/issue-147.md](implementation/issue-147.md).
The issue's full-stack acceptance is **incomplete** while Oracle capacity,
secrets, HTTPS/browser/OAuth validation and #95 shared storage/worker execution
remain outstanding. Repository preparation must not be reported as a live
full-stack deployment.
