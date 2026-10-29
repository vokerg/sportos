# ADR 0012: Durable targeted Garmin jobs and encrypted sessions

Status: Accepted for implementation in #226; deployment pending.

## Context

ADRs 0010/0011 and the targeted Garmin day/activity implementations retained
provider evidence safely but required an optional development-only local helper
inside the API. A hosted API could read retained evidence but could not request
new evidence. Mobile therefore lacked the same explicit Fetch/Refresh capability.
API and worker deployments must be independent of each other's local token files.

## Decision

The authenticated API validates a bounded day/activity request and persists an
owner-scoped Postgres job. A narrow dispatcher claims it; the owner-scoped worker
runs the existing targeted extraction, retention and reconciliation pipeline.
Shared server execution lives in `packages/garmin-runtime`; domain matching and
scoring remain separate. GETs remain read-only and recalculation never downloads.

Garmin's pinned SDK session is imported by a trusted operator and stored in a
separate credential table as an AES-256-GCM authenticated envelope bound to the
owner, connection, provider and session version. The initial import is restricted
to the maintained legacy account. Passwords and MFA remain interactive. This is
not a public multi-user Garmin authorization flow. The API and dispatcher cannot
read this table. Keys remain outside Postgres. A fixed private Python stdin/stdout
protocol imports/exports the session in memory; rotated sessions are persisted
under the current lease before the operation result is used.

One queued/running job per connection serializes refresh-token rotation. Identical
active requests deduplicate; later requests for the same day are allowed. Changed
evidence creates immutable versions. A lease check and primary row lock fence
primary, detail and blob operations. Cross-database publication is not atomic;
retained immutable auxiliary resources can survive interrupted publication and
be reused. Cancellation is cooperative. Rate-limit waits are durable and do not
consume attempts; stale recovery is bounded. Reconnect is explicit.

Capability combines owner connection state and a recent worker heartbeat, rather
than the API's machine or development mode. The connection retains the trusted
workstation's IANA calendar time zone. Web and native use bounded polling with
manual continuation, cancellation and retry; leaving a screen does not cancel a
server job. Public status excludes credentials, owners, leases and private paths.

## Consequences

A phone or hosted API can order work through the shared database without reaching
the worker directly. Workers need the pinned Python environment, separate primary
and detail non-owner roles, encryption keys and persistent original-byte storage.
Primary V143/V144 and detail V005/V006 are required; CONNECT is explicit because
PUBLIC database access is revoked. The Oracle deployment/storage hold in #95 is
unchanged. This decision supersedes API-local-only execution guidance for explicit
UI Fetch/Refresh; optional terminal tools remain supported.

This does not introduce archive import, automatic sync, Garmin-only canonical
activities, scoring changes or public Garmin account onboarding. See
[operations and protocol](../GARMIN_WORKER.md) and
[implementation evidence](../implementation/issue-226.md).
