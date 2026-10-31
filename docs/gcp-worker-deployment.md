# GCP worker deployment (native systemd)

This prepares the existing GCP VM for the SportOS background worker without
Docker. **Nothing in this change provisions cloud infrastructure, changes IAM,
modifies the VM, runs migrations, or deploys production.** The setup commands
below are explicit operator actions. Keep deployment disabled until ready.

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
2. **Shared source storage:** imports always poll in the current entry point.
   `LocalUploadStorage` cannot read the Render API's ephemeral upload directory
   from this VM. A local VM directory is persistent across releases but is not
   automatically shared with the API. Resolve source availability and recovery
   for every queue this worker can claim before enabling it. Do not start a
   supposedly Garmin-only worker while inaccessible import jobs can be claimed.
   This deployment task does not implement shared storage or lift the existing
   Oracle worker hold. See [hosted topology](DEPLOYMENT.md) and
   [Garmin original retention](GARMIN_WORKER.md).

Also verify the primary/detail schema, non-owner role grants, encryption key ring
and Garmin session import with the existing operator procedures. Migrations and
interactive Garmin login remain separate; no production DB secrets enter CI.

## Deployment and control behavior

- `gcp-worker-deploy.yml` listens only to `pull_request_target: closed` targeting `main`,
  and requires `merged == true`, base `main`, and the expected base repository.
  Unmerged closes, opened/updated PRs, direct pushes and tags cannot deploy.
  The target event supports production environment/OIDC access for merged fork
  PRs too; it never checks out an unmerged PR head.
- It checks out the exact immutable merge/squash/rebase result SHA, requires it
  still be `main`, installs locked dependencies, runs existing type/tests/guards
  and offline Garmin tests, and packages only after success. It checks `main`
  again immediately before deployment, so an old delayed run fails safely instead
  of overwriting a newer release. If superseded, merge a subsequent PR rather
  than deploying an arbitrary branch. Protect `main` against direct pushes.
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
- Verification proves process stability, not successful completion of a provider
  job or end-to-end DB/storage health. Verify those separately after approval.
  Automatic rollback does not undo already committed DB jobs or migrations.

## One-time GCP setup — operator only

Run from an authenticated administrator's workstation/Cloud Shell. Inspect
existing resources first and omit already satisfied changes. These variables use
values observed in this session; replace them if targeting another VM. The VM's
attached service account, OS Login state, IAM bindings and network rules have
**not** been inspected by this implementation.

```sh
export PROJECT_ID=project-41821059-f29b-4ba5-b0a
export VM_NAME=instance-20261031-185512
export VM_ZONE=us-central1-c
export REPOSITORY=vokerg/sportos
export REPOSITORY_ID=1243784372
export OWNER_ID=4003371
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
existing agents/services and obtain approval for any detach. The worker unit
blocks metadata IP access as defense in depth; that does not restrict the
separate deployment login. Do not grant CI Compute Admin, Editor, Owner, metadata
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
example for the observed `default` VPC; verify it is still the correct network.
Keep unrelated instance tags intact:

```sh
gcloud compute instances add-tags "$VM_NAME" --project="$PROJECT_ID" \
  --zone="$VM_ZONE" --tags=sportos-worker-iap
gcloud compute firewall-rules create sportos-worker-iap-ssh --project="$PROJECT_ID" \
  --network=default --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges=35.235.240.0/20 --target-tags=sportos-worker-iap
```

Do not add `0.0.0.0/0`, an external IPv4, or a NAT gateway for CI transport.
Inspect existing broad rules separately; this procedure does not delete them.

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
bootstrap is installed). Pin the host key first as described below. No sudo is
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

`worker.env.example` lists the configuration. Always supply the two separate
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

Only after egress, source availability, role grants, migrations and configuration
have been verified by the operator, create the readiness marker:

```sh
sudo install -o root -g root -m 0644 /dev/null /etc/sportos/worker-ready
```

It is an operator acknowledgment, not an automated connectivity/backup test.

## GitHub environment, variables and secret

Create environment **`gcp-worker-production`** in SportOS → Settings →
Environments. Allow deployments from **selected branch `main` only** (not tags).
Restrict write access to maintainers and require PR CI checks/PR review on `main`.
Optional required reviewers add a human approval before each deployment/control;
without reviewers, a successful eligible PR merge deploys automatically once
enabled. Protect workflow/deployment file review as production code.

Set the following environment variables (these identifiers are not secrets):

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `project-41821059-f29b-4ba5-b0a` |
| `GCP_VM_NAME` | `instance-20261031-185512` |
| `GCP_VM_ZONE` | `us-central1-c` |
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
secret, or worker runtime secrets. Existing CI test secrets remain optional and
must point only at test databases.

## First and subsequent deployment

1. Keep this implementation on a reviewed PR; no merge/deploy is performed by
   this task. Complete/approve the one-time cloud and VM setup separately.
2. Configure the GitHub environment/variables/host key and validate manual
   **status** can authenticate/connect (a not-yet-deployed service is correctly
   reported as inactive/failure).
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
  at most three releases; remove abandoned `.staging.*` and partial incoming
  uploads only after confirming no operation is running. Original data growth and
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
