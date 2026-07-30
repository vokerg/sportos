# Roadmap

This roadmap is organized by product risk, not by UI surface area. SportOS first establishes trustworthy imported facts and deterministic scores, then makes the workflow convenient, then adds accounts/integrations, and only then introduces AI-assisted analysis.

## Status vocabulary

- **Implemented**: source code exists for the capability.
- **Validated**: representative automated tests or repeatable evidence exists.
- **Operational**: the capability has observable failure handling and can be used repeatedly without repository-level intervention.

A feature is not delivered solely because a component or table exists.

## Current baseline

| Area | Current state | Main remaining gap |
|---|---|---|
| Repository setup | Validated | routine dependency/platform maintenance |
| Database schema | Validated for fresh migration | backup/recovery and hosted operations |
| Raw provenance | Validated | ownership boundaries for multi-user use |
| Daily ledger import | Validated and operational for local paths | browser upload and durable storage |
| Running workbook import | Validated and operational for local paths | provider ingestion and broader variants |
| Import diagnostics | Validated | user-friendly upload/job workflow |
| Deterministic scoring | Validated | version-management UI and audited recomputation |
| Score reconciliation | Validated on sanitized evidence | permitted historical workbook evidence for unresolved coefficients/formulas |
| API | Validated local read/import contracts | authentication and hosted error/operational policy |
| Web UI | Implemented local review workflow | complete non-developer cockpit and upload flow |
| Hosted/multi-user operation | Not implemented | uploads, jobs, auth, isolation, deployment |
| Integrations | Not implemented | provider adapters, credentials, cursors, deduplication |
| AI analysis | Intentionally not implemented | stable authorized read tools and evaluation |

## Milestone 0: trustworthy local ingestion

### Goal

Turn the initial scaffold into a repeatable, explainable local data pipeline.

### Delivered scope

- reproducible install, workspace validation, tests, and builds;
- sanitized XLSX fixtures for supported workbook layouts;
- raw-row provenance and canonical source links;
- transactional/idempotent imports and failure rollback;
- score-breakdown API and Daily Log reconciliation;
- import history, row diagnostics, affected dates, and privacy controls;
- explicit rule units, rounding, thresholds, effective dates, priorities, and bonus classification;
- exact/explained/unresolved score reconciliation with zero default tolerance;
- machine-readable fixture evidence and documented unresolved workbook semantics.

### Exit criteria

The checklist and evidence are maintained in [FIRST_MILESTONE.md](FIRST_MILESTONE.md). The decisive outcome is that a developer can trace a daily total to source rows and rule calculations, explain supported differences, and label unsupported differences without guessing.

## Milestone 1: usable local cockpit

### Goal

Replace developer-oriented local-path operations with a coherent single-user workflow.

### Ordered work

1. browser file upload and a durable, replaceable storage boundary;
2. asynchronous import jobs with progress, retries, cancellation, and idempotent execution;
3. Rules Studio with version activation, preview, audited recomputation, and history;
4. complete daily/performance/provenance drill-downs and canonical export.

### Exit criteria

A non-developer can import supported files, understand failures, inspect score calculations, manage versioned rules safely, and repeat the workflow without filesystem paths or a CLI.

## Milestone 2: accounts and integrations

### Goal

Support durable personal use across devices and ingest external providers without weakening provenance.

### Ordered work

- authentication and user/account ownership boundaries;
- deployment configuration and secret management;
- ownership-scoped repository/API authorization;
- provider-neutral ingestion interfaces;
- encrypted credentials and refresh handling;
- first Strava adapter, then additional providers where justified;
- provider cursors, rate limits, retries, and backfills;
- cross-source identity and duplicate policy;
- time-zone/locale policy, monitoring, backups, and recovery.

### Exit criteria

A user can safely connect a supported provider, backfill history, and understand the provenance and ownership of every canonical fact.

## Milestone 3: read-only analysis and coaching tools

### Goal

Add AI-assisted querying and explanation without allowing generated text to become authoritative data.

### Work

- narrow, read-only tools over stable views;
- documented tool schemas and authorization boundaries;
- answers that cite dates, activities, rules, and source provenance;
- deterministic calculations outside the model;
- evaluation cases for hallucination, missing data, conflicts, and imported-text prompt injection;
- explicit separation between observations, uncertainty, suggestions, and official records.

### Exit criteria

AI features can summarize or explain canonical data while all authoritative calculations and writes remain deterministic, permission-checked, and auditable.

## Near-term PR queue

The authoritative order is maintained in GitHub issue #3. After MVP-0 coefficient reconciliation, the intended sequence is:

1. browser upload and durable file storage;
2. asynchronous import job lifecycle;
3. Rules Studio and audited score recomputation;
4. cockpit drill-downs and canonical export;
5. authentication and ownership;
6. provider ingestion;
7. read-only AI analysis.

Each PR must identify the milestone exit criterion it advances and include repeatable evidence appropriate to the risk.

## Decision log candidates

Record these decisions before implementation spreads across packages:

- durable file/object-storage ownership and retention;
- import-job state machine, cancellation, and retry semantics;
- rule-version activation, overlap, and historical recomputation;
- canonical activity identity across providers;
- date, time-zone, and locale handling;
- ownership of facts derived from multiple sources;
- authentication/session strategy;
- hosted API error format and operational observability;
- backup, restoration, and deletion policy.
