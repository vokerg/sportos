# GCP worker deployment (native systemd)

This guide covers the existing GCP VM's native SportOS worker without Docker.
One-time cloud/host setup is an explicit operator action; application CI does not
provision infrastructure or run migrations. Keep a new target's deployment gate
false until its readiness checks and production activation are approved.

## Verified operating status — 2026-11-01

The first approved merged-PR deployment completed successfully in
[run 41281910050](https://github.com/vokerg/sportos/actions/runs/41281910050).
The non-root systemd service passed stable-process checks, private environment
validation and a new Garmin database heartbeat check. Uploaded CSV/XLSX polling
is explicitly disabled; Strava/Garmin and rule processing remain configured.
Runtime configuration stays outside releases/CI and is root-owned 0600.

No provider job was queued during activation, so this verifies service/database
readiness rather than a completed provider download. Use a bounded Fetch/Refresh
in the application to verify that separately. An existing local development
worker was left running; leases coordinate claims, and the VM's new heartbeat was
checked against a pre-activation baseline. Stop local execution deliberately if
an exclusively hosted worker is desired; do not kill a whole development stack
as an automatic deployment side effect. Actual cloud inventory remains private.

## What runs

`apps/worker/src/import-worker.ts` builds to `dist/import-worker.js`. Node.js 22
runs continuous polling loops for durable Postgres import, rule-change and
optional Strava/Garmin jobs; this is not a cron task or an HTTP server. Queue
leases and account-scoped writes use separate dispatcher and worker-data logins.
SIGINT/SIGTERM abort polling, finish/release work according to the existing runner
semantics, and close database pools. systemd allows 120 seconds before killing
the process group; persisted leases recover work if shutdown cannot finish.

Garmin optionally invokes `tools/garmin/worker_bridge.py` and the pinned
`tools/garmin/requirements.txt` SDK. Releases include the Node 22 binary, built
workspace packages, production pnpm dependencies, helper code and Python 3.13
Linux x86_64 wheels. CI downloads binary wheels only; the VM creates a venv and
installs offline, with no package compilation, npm, pnpm, git, or Docker needed
for normal deployment. Debian 13 x86_64 with Python 3.13 is the initial target;
changing OS/architecture/Python requires rebuilding and verifying compatibility.

The existing CI (`.github/workflows/ci.yml`) remains intact, including its
conditional Neon integration gates and disposable Garmin database suite. The new
packaging job tests deployment recovery and verifies offline installation and
systemd syntax on Linux. There is no existing standalone lint script: use the
repository's architecture guards, TypeScript checks and tests.

## Two prerequisites that code deployment does not solve

1. **Internet egress:** this VM was created with no external IP. IAP provides
   inbound administration, not outbound access to Neon, Strava or Garmin. Select
   and test an egress route before starting the worker. An existing egress proxy
   may be reusable; IPv6 requires subnet/routes and endpoint compatibility checks.
   This change creates neither a NAT gateway nor a public IPv4. If an external
   IPv4 is chosen later, approve its recurring cost first.
2. **Queue scope and original storage:** this VM runs Strava/Garmin provider sync
   and rule recomputation with `SPORTOS_IMPORT_WORKER_ENABLED=false`. This prevents
   construction/polling of uploaded CSV/XLSX import consumers; queued uploads remain
   untouched. The normal worker default is `true` when unset, preserving existing
   deployments. Only exact `true`/`false` values are accepted (surrounding whitespace
   is ignored); a typo fails startup before opening a DB connection.
   `LocalUploadStorage` cannot read the Render API's ephemeral upload directory
   from this VM. Do not enable file-import polling until shared source access and
   recovery are provided. This switch does not disable Strava, Garmin or rules and
   does not remove the upload API/UI. Garmin still requires the persistent private
   `SPORTOS_UPLOAD_DIR` for downloaded FIT/ZIP originals; do not delete that path.
   This task does not implement shared storage or lift the existing Oracle worker
   hold. See [hosted topology](DEPLOYMENT.md) and [Garmin original retention](GARMIN_WORKER.md).

Also verify the primary/detail schema, non-owner role grants, encryption key ring
and Garmin session import with the existing operator procedures. Migrations and
interactive Garmin login remain separate; no production DB secrets enter CI.

## Deployment and control behavior

- `gcp-worker-deploy.yml` listens only to `pull_request_target: closed` targeting `main`,
  and requires `merged == true`, base `main`, and the expected base repository.
  Unmerged closes, opened/updated PRs, direct pushes and tags cannot deploy.
  The target event supports production environment/OIDC access for merged fork
  PRs too; it never checks out an unmerged PR head.
- A read-only changed-file gate inspects the merged PR's GitHub file list
  (including renamed source paths) using trusted merged code. A frontend-only,
  mobile-only or docs-only merge skips the reusable CI/package/deploy jobs;
  ordinary `ci.yml` still runs on every PR. API, worker, MCP, shared packages,
  Garmin helper, migrations and shared build files trigger the same full CI and
  worker packaging/deployment as before. See `scripts/deploy/change-scope.mjs`
  and [hosted build filters](DEPLOYMENT.md#production-deployment-scopes).
- It checks out the exact immutable merge/squash/rebase result SHA and calls
  the existing CI as a reusable workflow only for backend changes. All its
  jobs must pass, including disposable Garmin DB integration and conditional
  Neon gates. It then installs locked dependencies, runs Python 3.13 offline
  tests and packages only after success. Before packaging and again immediately
  before deployment, it verifies the exact release SHA is an ancestor of
  current `main` and that no **newer backend** change intervened. Later
  frontend-only merges are allowed, avoiding spurious stale-release failures;
  later backend merges still reject the older release. Protect `main` against
  direct pushes (which do not trigger this worker workflow).
- Only the deploy job has `id-token: write` and enters `gcp-worker-production`.
  Repository variable `GCP_WORKER_DEPLOY_ENABLED=true` enables that job. While
  false/unset, merged code is checked/packaged but no GCP authentication occurs.
- `gcp-worker-control.yml` is separate, `workflow_dispatch` only, restricted to
  `main`, and offers exactly `start`, `stop`, `restart`, `status`. It builds,
  uploads and deploys nothing. Both workflows share concurrency group
  `sportos-gcp-worker-production` with cancellation disabled. GitHub can replace
  pending queued runs; it does not provide an unlimited FIFO. A VM-side `flock`
  also serializes deployment/control/rollback operations.
- Both use WIF service-account impersonation, OS Login and SSH through IAP. No
  JSON service-account key, long-lived private SSH key, public SSH port or public
  address is required. The VM host key is pinned; CI fails on key changes.
- Releases live under `/opt/sportos/releases/SHA-RUN-ATTEMPT`. Deployment verifies
  SHA256, archive bounds/paths, bundled runtime/imports and offline Python install
  before atomically switching `current`, restarting and checking a stable PID and
  restart count for 20 seconds. On failure it restores/restarts the old release
  and returns failure. Failed first activation stops the service. Current,
  previous and one extra release are retained; incoming uploads are removed.
  Before each upload, a locked prepare step removes abandoned upload/staging
  files left by interrupted runs.
- Verification proves process stability, not successful completion of a provider
  job or end-to-end DB/storage health. Verify those separately after approval.
  Automatic rollback does not undo already committed DB jobs or migrations.

## One-time GCP setup — operator only

Run from an authenticated administrator's workstation/Cloud Shell. Inspect
existing resources first and omit already satisfied changes. Replace every `YOUR_*` placeholder below using your private deployment inventory.
Keep actual infrastructure identifiers in private operations documentation and
GitHub environment settings; do not commit them to this public repository. The VM's
attached service account, OS Login state, IAM bindings and network rules have
**not** been inspected by this implementation.

```sh
export PROJECT_ID=YOUR_GCP_PROJECT_ID
export VM_NAME=YOUR_GCP_VM_NAME
export VM_ZONE=YOUR_GCP_VM_ZONE
export REPOSITORY=YOUR_GITHUB_OWNER/YOUR_GITHUB_REPOSITORY
export REPOSITORY_ID=YOUR_GITHUB_REPOSITORY_NUMERIC_ID
export OWNER_ID=YOUR_GITHUB_OWNER_NUMERIC_ID
export POOL_ID=sportos-github
export PROVIDER_ID=github
export DEPLOY_SA_NAME=sportos-worker-deploy
export DEPLOY_SA="$DEPLOY_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud compute instances describe "$VM_NAME" --project="$PROJECT_ID" --zone="$VM_ZONE" \
  --format='yaml(id,status,machineType,metadata,networkInterfaces,serviceAccounts)'

gcloud services enable compute.googleapis.com iap.googleapis.com \
  oslogin.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com --project="$PROJECT_ID"

gcloud iam service-accounts create "$DEPLOY_SA_NAME" --project="$PROJECT_ID" \
  --display-name='SportOS worker GitHub deployment'

gcloud iam workload-identity-pools create "$POOL_ID" --project="$PROJECT_ID" \
  --location=global --display-name='SportOS GitHub Actions'

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID" \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id' \
  --attribute-condition="assertion.repository_id == '$REPOSITORY_ID' && assertion.repository_owner_id == '$OWNER_ID' && assertion.ref == 'refs/heads/main' && assertion.sub == 'repo:$REPOSITORY:environment:gcp-worker-production' && ((assertion.event_name == 'pull_request_target' && assertion.workflow_ref == '$REPOSITORY/.github/workflows/gcp-worker-deploy.yml@refs/heads/main') || (assertion.event_name == 'workflow_dispatch' && assertion.workflow_ref == '$REPOSITORY/.github/workflows/gcp-worker-control.yml@refs/heads/main'))"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository_id/$REPOSITORY_ID"

# Non-admin OS Login, scoped to this instance. Do not grant osAdminLogin.
gcloud compute instances add-iam-policy-binding "$VM_NAME" --project="$PROJECT_ID" \
  --zone="$VM_ZONE" --role=roles/compute.osLogin --member="serviceAccount:$DEPLOY_SA"

# gcloud also needs project discovery; avoid project-wide Compute Admin/Viewer.
gcloud iam roles create sportosProjectLookup --project="$PROJECT_ID" \
  --title='SportOS project lookup' --permissions=compute.projects.get --stage=GA
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --role="projects/$PROJECT_ID/roles/sportosProjectLookup" --member="serviceAccount:$DEPLOY_SA"
```

In **Security → Identity-Aware Proxy → SSH and TCP resources**, select only this
VM, add the deployment service account, and grant **IAP-secured Tunnel User**
(`roles/iap.tunnelResourceAccessor`). Add an IAM condition
`destination.port == 22`. Do not grant the role project-wide when VM-scoped
access is sufficient.

If the VM has an attached service account, OS Login also requires
`roles/iam.serviceAccountUser` **on that attached account**, not the project:

```sh
export VM_SERVICE_ACCOUNT="$(gcloud compute instances describe "$VM_NAME" \
  --project="$PROJECT_ID" --zone="$VM_ZONE" --format='value(serviceAccounts[0].email)')"
# Only if nonempty, after reviewing that account's existing privileges:
gcloud iam service-accounts add-iam-policy-binding "$VM_SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" --role=roles/iam.serviceAccountUser --member="serviceAccount:$DEPLOY_SA"
```

An attached privileged service account increases what an SSH user could access.
Prefer no attached account if the worker needs none, but first assess effects on
existing agents/services and obtain approval for any detach. The guest DNS
resolver can share the metadata IP, so blocking that entire IP in systemd would
also break DNS. This unit therefore does not claim to isolate attached-account
credentials; keep that account absent or minimally privileged. Do not grant CI Compute Admin, Editor, Owner, metadata
write permissions, schema-owner DB access, or unrestricted sudo.

Enable OS Login on **this instance only**, after keeping an existing admin
session open and ensuring your own administrator retains OS Login/admin access.
OS Login changes how metadata SSH keys are used; do not lock out the operator.

```sh
gcloud compute instances add-metadata "$VM_NAME" --project="$PROJECT_ID" \
  --zone="$VM_ZONE" --metadata=enable-oslogin=TRUE
```

IAP needs ingress TCP/22 from `35.235.240.0/20`. Existing browser IAP access worked,
so inspect before adding anything. If no suitable rule exists, this is a scoped
example using `YOUR_VPC_NETWORK`; replace it with the verified VPC name.
Keep unrelated instance tags intact:

```sh
gcloud compute instances add-tags "$VM_NAME" --project="$PROJECT_ID" \
  --zone="$VM_ZONE" --tags=sportos-worker-iap
gcloud compute firewall-rules create sportos-worker-iap-ssh --project="$PROJECT_ID" \
  --network=YOUR_VPC_NETWORK --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges=35.235.240.0/20 --target-tags=sportos-worker-iap
```

Do not add `0.0.0.0/0`, an external IPv4, or a NAT gateway for CI transport.
Inspect existing broad rules separately; this procedure does not delete them.

## IPv6 egress option — operator only

External IPv6 can provide outbound connectivity without an external IPv4 address
or Cloud NAT. GCP's default auto-mode network does not support IPv6 subnets. A
separate custom VPC with a dual-stack subnet preserves the original network for
rollback; moving an existing IPv4-only VM requires stopping it first. Approve the
network/firewall and VM lifecycle changes before executing them. Keep actual
network inventory and the migration/rollback record in private operations docs.

Allow inbound TCP/22 only from IAP's documented source range for the intended
VM; unsolicited IPv6 internet access should remain denied. Preserve strict host
key checking after migration. Check both cloud routes and the guest DHCPv6 address
and default route, then test IPv6 DNS and certificate-verified TLS from the VM to
all configured DB endpoints, provider auth/API/download hosts and package mirrors.
A Mac DNS check or an unauthenticated HTTP response is insufficient to establish
worker readiness: authenticated operations and redirects can require other hosts.
The token-based Garmin helper's path differs from legacy browser/password login;
verify the configured session flow rather than assuming every Garmin host supports
IPv6. Do not add a charged IPv4/NAT fallback automatically if a dependency fails.

External IPv6 addresses on VMs and IPv6 ranges on subnets have no address charge
under current [VPC pricing](https://cloud.google.com/vpc/pricing), but internet
traffic can still incur charges beyond applicable allowances. See Google's
[migration procedure](https://docs.cloud.google.com/compute/docs/instances/migrating-interfaces-between-networks)
and [IPv6 configuration](https://docs.cloud.google.com/compute/docs/ip-addresses/configure-ipv6-address).
Network transport checks do not authorize bootstrap or enable the deployment gate;
queue scope, persistent provider originals and the remaining readiness checks still apply.

## One-time Linux setup — operator only

The VM needs Debian 13 x86_64, Python 3.13/venv, CA certificates, systemd, OpenSSH
server, sudo, GNU coreutils/tar/gzip and util-linux (`flock`). Once an approved
egress route or offline package source exists:

```sh
sudo apt-get update
sudo apt-get install --yes --no-install-recommends \
  python3 python3-venv ca-certificates libstdc++6 libgcc-s1 \
  openssh-server sudo coreutils tar gzip util-linux
python3 --version  # must be 3.13.x
uname -m           # must be x86_64
```

No Node install is needed on the VM: each release contains the tested Node 22
binary and its license. Do not run apt commands expecting IAP to provide egress.
For offline provisioning, obtain matching Debian packages and dependencies on a
trusted connected Debian 13 machine and transfer them through IAP.

Get the CI service account's numeric ID and OS Login username. Service accounts
use `sa_<uniqueId>`; verify the OS Login profile/first login rather than guessing
from its email. An administrator can inspect the profile by impersonating the
account if already authorized to do so; do not grant broad impersonation just to
run this step:

```sh
gcloud iam service-accounts describe "$DEPLOY_SA" --project="$PROJECT_ID" --format='value(uniqueId)'
# With existing authorized impersonation, inspect the actual POSIX account:
gcloud compute os-login describe-profile --project="$PROJECT_ID" \
  --impersonate-service-account="$DEPLOY_SA" --format='value(posixAccounts.username)'
```

Have the service account make its first OS Login SSH connection to materialize
its Linux account. This can be an operator-run impersonated `gcloud compute ssh`
with `--tunnel-through-iap`, or a first **status** workflow (expected to fail until
bootstrap is installed). The manual workflow is available only after its file
has merged to `main`: if using that route, merge the implementation with
`GCP_WORKER_DEPLOY_ENABLED` unset/false, run status to materialize the account,
finish setup, and use a subsequent reviewed PR for first deployment. Pin the host
key first as described below. No sudo is
needed for that first login. Then, in your administrator session on the VM, use
the **actual** username:

```sh
export CI_LOGIN=sa_REPLACE_WITH_ACTUAL_UNIQUE_ID
getent passwd "$CI_LOGIN"
```

Transfer the reviewed `deploy/gcp/` files from this repository to a temporary
directory using your existing admin IAP connection, then inspect/run:

```sh
# On your workstation, from the SportOS checkout:
gcloud compute scp --recurse deploy/gcp "$VM_NAME:~/sportos-gcp-setup" \
  --project="$PROJECT_ID" --zone="$VM_ZONE" --tunnel-through-iap
# On the VM:
sudo bash ~/sportos-gcp-setup/bootstrap.sh "$CI_LOGIN"
sudoedit /etc/sportos/worker.env
sudo chmod 0600 /etc/sportos/worker.env
sudo chown root:root /etc/sportos/worker.env
```

Bootstrap creates the non-login `sportos-worker` runtime user and a separate
`sportos-deploy` group for the OS Login CI account. The CI account can manage
releases and invoke only five fixed root-owned service helper commands via sudo.
It cannot edit the unit, privileged helper or environment file. Bootstrap enables
boot startup but does **not** start the service. It also caps the existing
host-wide journal at 100 MB persistent / 30 MB runtime / seven days; review this
host-wide log retention choice before running it. Reconnect CI after group changes.

`worker.env.example` selects `SPORTOS_IMPORT_WORKER_ENABLED=false` for this VM.
Keep it false for provider/rule processing without shared API upload storage.
Always supply the two separate
primary database URLs. Configure Strava client credentials plus the existing
versioned encryption key ring together to enable provider sync. For Garmin,
also set `SPORTOS_GARMIN_WORKER_ENABLED=true` and the dedicated detail worker-data
URL; complete [Garmin setup/session import](GARMIN_WORKER.md) on a trusted
workstation. Never create a fresh ring when existing credentials require the old
keys. Do not copy API/session/Flyway/schema-owner/legacy credentials into this file.

The unit supplies the absolute upload and per-release Python paths, production
mode, a 384 MB V8 heap, a 700 MB cgroup memory cap (including Python), one import
slot, and CPU/process limits. `worker.env` can override non-secret tuning; keep
concurrency at one. Large XLSX imports may still exceed this machine's memory.
The user must deliberately review persistent-source backups and disk growth;
release pruning never deletes uploaded originals.

Only after egress, source availability for enabled queues, role grants, migrations and configuration
have been verified by the operator, create the readiness marker:

```sh
sudo install -o root -g root -m 0644 /dev/null /etc/sportos/worker-ready
```

It is an operator acknowledgment, not an automated connectivity/backup test.

## Provider/rule first-activation checklist

For the separate GCP worker, use this scope before enabling deployment:

1. Confirm the deployed revision includes `SPORTOS_IMPORT_WORKER_ENABLED` and the
   protected VM environment explicitly sets it to `false`. An unset flag retains
   normal imports; do not rely on the general default for this VM.
2. Keep `/var/lib/sportos/uploads` private and persistent for Garmin downloads.
   The switch does not make Garmin's FIT/ZIP originals disposable. Do not delete
   existing API uploads or queued import jobs; this worker leaves them unclaimed.
3. Validate the primary dispatcher, primary worker-data and separate detail login
   with read-only checks. Confirm non-superuser/non-bypass roles, required schema
   and grants. Validate the existing encryption ring against the stored provider
   envelopes privately; never expose tokens, keys or envelope contents in CI/logs.
4. Install only the required runtime configuration on the VM through authenticated
   IAP, root-owned 0600. Keep CI deployment credentials separate from DB/provider
   configuration. Validate the parsed environment without printing its values.
5. After all prerequisites pass, create the readiness marker. Obtain production
   activation approval, enable the deployment gate, and merge a reviewed PR to
   main. Existing queued Strava/Garmin and rule jobs may run as soon as the service
   starts; file-import jobs remain excluded.
6. Require successful workflow activation/stability checks, then manual status.
   Check the private application journal, Garmin worker heartbeat and resource
   usage. A stable process/heartbeat does not prove that a provider download has
   succeeded; verify a bounded real job separately without exposing private data.
7. If activation fails, keep or restore the gate to false, inspect private
   diagnostics, and use the documented release recovery. Do not repeatedly start
   a failing worker or widen permissions/network access as a workaround.

## GitHub environment, variables and secret

Create environment **`gcp-worker-production`** in SportOS → Settings →
Environments. Allow deployments from **selected branch `main` only** (not tags).
Restrict write access to maintainers and require PR CI checks/PR review on `main`.
Optional required reviewers add a human approval before each deployment/control;
without reviewers, a successful eligible PR merge deploys automatically once
enabled. Protect workflow/deployment file review as production code.

Set the following **environment secrets**. These identifiers are not authentication
credentials, but using GitHub Secrets ensures they are redacted in this public
repository's Actions logs; ordinary variables are not masked.

| Environment secret | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `YOUR_GCP_PROJECT_ID` |
| `GCP_VM_NAME` | `YOUR_GCP_VM_NAME` |
| `GCP_VM_ZONE` | `YOUR_GCP_VM_ZONE` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | actual `$DEPLOY_SA` email from setup |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/sportos-github/providers/github` (use actual project number) |

Set **repository-level** variable `GCP_WORKER_DEPLOY_ENABLED` to `true` only after
the above setup is approved/completed. Leave false/unset while preparing this PR.
This must be repository-level because the deployment job's `if` is evaluated
before its environment is entered. Set it false to disable subsequent automatic
deployments; manual controls remain available.

Set environment secret **`GCP_SSH_KNOWN_HOSTS`**. Build its line from the instance
numeric ID and the host public key obtained in your already authenticated admin
session; do not blindly trust `ssh-keyscan` output:

```sh
# Workstation: obtain the instance ID.
gcloud compute instances describe "$VM_NAME" --project="$PROJECT_ID" \
  --zone="$VM_ZONE" --format='value(id)'
# VM administrator session: obtain the host PUBLIC key, never a private key.
sudo cat /etc/ssh/ssh_host_ed25519_key.pub
# Secret format (replace both values; retain the compute. prefix):
# compute.INSTANCE_NUMERIC_ID ssh-ed25519 AAAA...PUBLIC_KEY
```

The transport writes this line into gcloud's canonical
`~/.ssh/google_compute_known_hosts` and requires strict host checking. If the VM is
recreated or its host keys rotate, verify the new key through a trusted channel
and update the secret. The repository needs no GCP JSON key, SSH private-key
secret, or worker runtime secrets. Infrastructure settings above use Secrets for
log redaction; `GCP_WORKER_DEPLOY_ENABLED` remains a non-sensitive repository variable. Existing CI test secrets remain optional and
must point only at test databases.

## First and subsequent deployment

1. Keep this implementation on a reviewed PR; no merge/deploy is performed by
   this task. Complete/approve the one-time cloud and VM setup separately.
2. Configure the GitHub environment/secrets/host key. If the workflow is already
   on `main` with deployment disabled, use manual **status** to validate access
   (a not-yet-deployed service is correctly reported inactive/failure). Otherwise
   validate through an already authorized operator impersonation connection; the
   manual workflow cannot be dispatched from an unmerged implementation PR.
3. After prerequisites and the marker are ready, set
   `GCP_WORKER_DEPLOY_ENABLED=true`.
4. Merge this PR, or a subsequent small reviewed PR if setup completed after it
   merged. Only a successful PR merge to `main` invokes the deployment workflow;
   there is deliberately no manual deploy input. Re-running an eligible merged
   run is safe while its SHA is still main; run attempts get distinct releases.
5. Verify the deployment job, then use **status** and an explicit bounded worker
   job to validate DB/provider/storage behavior. Avoid simultaneously running an
   old local/Oracle worker; do not let it consume jobs with inaccessible storage.

Subsequent reviewed PR merges follow the same path. No production migrations
are automated. Review schema/queued-job compatibility before merging worker or
migration changes. Unit/bootstrap/helper changes require an explicit operator
re-install; deploys update application releases only, never privileged host files.

## Manual operation and logs

GitHub → Actions → **GCP worker start stop restart or status** → Run workflow →
branch `main` → action. Start/restart must remain active with a stable PID for
20 seconds; stop must reach `inactive`; status exits nonzero if inactive/failed.
A deliberate stop cancels systemd's automatic crash restart, leaves the VM running,
and preserves data. The enabled service starts again on reboot; a later deployment
also restarts it. To keep it stopped across deployments, disable automatic deploys
as well. Disable boot startup separately as an explicit operator action if needed.

Failures show service state/result/restart count and recent **systemd lifecycle
logs** only. SportOS is a public repository: raw application logs could expose
private sports/provider data, so the Actions helper does not upload them.
Inspect application logs privately on the VM:

```sh
sudo systemctl status sportos-worker.service --no-pager
sudo journalctl -u sportos-worker.service -n 100 --no-pager
sudo journalctl -u sportos-worker.service -f
readlink -f /opt/sportos/current
cat /opt/sportos/current/REVISION
```

Do not paste raw logs, DB URLs or provider payloads into public issues/Actions.

## Rollback

A failed activation automatically restores the previous symlink and restarts it,
but the workflow still fails. If no previous release exists it stops the service.
If rollback restart also fails, investigate privately before re-enabling work.

For an intentional rollback, first set `GCP_WORKER_DEPLOY_ENABLED=false`, wait for
any active deployment to finish, and verify schema/queued-job/encryption-key
compatibility. As the deployment OS Login account on the VM:

```sh
readlink -f /opt/sportos/previous
ls -1 /opt/sportos/releases
# Replace with an existing retained directory name, not an arbitrary path:
/usr/local/bin/sportos-worker-deploy rollback FULL_SHA-RUN_ID-ATTEMPT
```

The same
lock, activation check and failure recovery apply. Do not run this unprivileged
release manager as root. Use a reviewed revert PR for the lasting source fix,
then re-enable auto-deploy when ready. No database or secret rollback is attempted.

## Troubleshooting and costs

- **WIF rejected:** verify numeric repo/owner IDs, environment subject, main branch,
  event/workflow allowlist, provider name, IAM binding, and environment protection.
  IAM propagation can take several minutes. Do not broaden trust to PR heads.
- **OS Login/IAP denied:** verify instance-scoped OS Login + IAP grants,
  project lookup, attached-SA Service Account User if needed, API enablement,
  TCP/22 IAP source rule, and the actual POSIX username. No metadata-write grant
  should be needed. Log out/in after adding the deployment group.
- **Host key mismatch:** verify keys through the operator channel; never disable
  strict checking. gcloud's host alias is `compute.INSTANCE_NUMERIC_ID`.
- **Artifact/wheel failure:** use Linux x86_64, Node 22 and Python 3.13, frozen pnpm
  lockfile and binary wheels. CI must fail rather than compile on the VM.
- **Active process, no jobs:** check egress/DNS/TLS, DB roles, API heartbeat,
  enabled provider settings and shared source availability. Process stability is
  not proof of provider or DB connectivity.
- **Inactive/crash/OOM:** inspect private journals and `systemctl show` memory/result,
  configuration and disk space. Correct the error, then restart after resolving
  start-rate limits (`sudo systemctl reset-failed sportos-worker`).
- **Disk low:** releases need 1.5 GiB free before staging; compressed archives are
  capped at 200 MiB and expanded contents at 750 MiB. A successful deploy retains
  at most three releases; its prepare step clears abandoned staging/uploads
  under the operation lock before the next upload. Original data growth and
  backups require a retention/recovery policy; they are never pruned by deploys.

The existing VM/disk can fit GCP's ongoing Free Tier if aggregate eligible usage
stays within the account allowances. WIF, IAM and IAP do not require provisioning
a new VM/NAT/bucket. This implementation creates no paid resources. Internet
egress, inter-region traffic, provider/database quotas, retained GitHub artifacts
and GitHub Actions usage can still incur charges. An external IPv4 on a Standard
VM currently costs $0.005/hour (about $3.65/730-hour month); IAP is not an egress
substitute. A Cloud NAT gateway has separate costs and is not installed here.
Budget alerts notify and do not impose a hard spending cap.

Official references checked 2026-10-31:

- [PR merged events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target)
- [Google GitHub authentication](https://github.com/google-github-actions/auth)
- [WIF deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [OS Login roles/setup](https://docs.cloud.google.com/compute/docs/oslogin/set-up-oslogin)
- [SSH through IAP](https://docs.cloud.google.com/compute/docs/connect/ssh-using-iap)
- [IAP TCP forwarding](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding)
- [Compute Free Tier](https://docs.cloud.google.com/free/docs/free-cloud-features#compute)
- [IP/network pricing](https://cloud.google.com/vpc/network-pricing#ipaddress)
