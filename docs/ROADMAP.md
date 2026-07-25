# Roadmap

This roadmap is organized by product risk, not by UI surface area. SportOS should first prove that imported facts and scores are trustworthy, then make the workflow convenient, then add integrations, and only then add AI-assisted analysis.

## Status vocabulary

- **Implemented**: source code exists for the capability.
- **Validated**: representative automated tests or repeatable manual evidence exist.
- **Operational**: the capability has observable failure handling and can be used repeatedly without repository-level intervention.

A feature should not be described as delivered solely because a component or table exists.

## Current baseline

| Area | Current state | Main gap |
|---|---|---|
| Repository setup | Implemented | clean-checkout validation and maintenance conventions |
| Database schema | Implemented | integration and migration verification |
| Raw provenance | Implemented | end-to-end traceability tests |
| Daily ledger import | Implemented | fixtures, idempotency, and variant coverage |
| Running workbook import | Implemented | ambiguous-sheet handling and fixtures |
| Deterministic scoring | Implemented and unit-tested in part | coefficient reconciliation and ledger UI |
| API | Implemented as a thin local API | validation, error contracts, and import history |
| Web UI | Implemented as a review shell | complete import/reconciliation workflow |
| Hosted/multi-user operation | Not implemented | uploads, jobs, auth, and isolation |
| Integrations | Not implemented | provider-specific ingestion and deduplication |
| AI analysis | Intentionally not implemented | stable read tools and trust boundaries |

## Milestone 0: trustworthy local ingestion

### Goal

Turn the existing scaffold into a repeatable, explainable local data pipeline.

### Work

- establish clean, reproducible install and CI behavior;
- create sanitized or synthetic XLSX fixtures for every supported workbook layout;
- test raw-row persistence and canonical normalization;
- define import transaction and partial-failure behavior;
- make repeated imports idempotent;
- expose score breakdown for a selected date;
- display app total, spreadsheet total, and delta together;
- reconcile scoring coefficients and document unresolved differences;
- surface import status, warnings, errors, and affected dates;
- document all confirmed and unknown workbook semantics.

### Exit criteria

Use the checklist in [FIRST_MILESTONE.md](FIRST_MILESTONE.md). The decisive outcome is that a developer can explain where a daily total came from and why it differs from the spreadsheet.

## Milestone 1: usable local cockpit

### Goal

Replace developer-oriented local-path operations with a coherent single-user workflow.

### Work

- browser file upload;
- durable file storage abstraction;
- asynchronous import jobs with progress, retries, and cancellation rules;
- import history and row-level diagnostics;
- source-file fingerprinting and duplicate detection;
- Rules Studio for viewing and editing versioned scoring rules;
- score recomputation workflow with preview and audit history;
- daily-log drill-downs and performance trend views;
- export of canonical or reconciled data.

### Exit criteria

A non-developer can import supported files, understand failures, inspect score calculations, and repeat the workflow without using filesystem paths or a CLI.

## Milestone 2: accounts and integrations

### Goal

Support durable personal use across devices and ingest data from external providers without weakening provenance.

### Work

- authentication and user ownership boundaries;
- deployment configuration and secret management;
- per-user data isolation and authorization tests;
- Strava and Garmin ingestion adapters;
- Google Sheets and FIT ingestion where justified;
- provider cursors, rate-limit handling, retries, and backfills;
- cross-source activity identity and deduplication;
- time-zone and locale policy;
- operational monitoring, backups, and recovery procedures.

### Exit criteria

A user can safely connect a supported provider, backfill history, and understand the provenance of every canonical fact.

## Milestone 3: read-only analysis and coaching tools

### Goal

Add AI-assisted querying and explanation without allowing generated text to become authoritative data.

### Work

- narrow, read-only tools over stable views;
- documented tool schemas and authorization boundaries;
- answers that cite dates, activities, rules, and source provenance;
- deterministic calculations outside the model;
- evaluation cases for hallucination, missing data, and conflicting sources;
- explicit separation between observations, suggestions, and official records.

### Exit criteria

AI features can summarize or explain canonical data while all authoritative calculations and writes remain deterministic and auditable.

## Near-term PR queue

The next maintenance and feature work should be kept in reviewable slices:

1. importer fixture harness and workbook samples;
2. import idempotency and transaction tests;
3. score-breakdown endpoint and repository query;
4. score reconciliation UI;
5. import history and diagnostics;
6. coefficient reconciliation and rules documentation;
7. browser upload plus asynchronous job boundary.

Each PR should state which milestone exit criterion it advances and include evidence appropriate to the change.

## Decision log candidates

The following decisions should be recorded before implementation spreads across packages:

- canonical activity identity and duplicate policy;
- source-file retention and privacy policy;
- transaction boundary for one import batch;
- rule-version activation and historical recomputation semantics;
- date, time-zone, and locale handling;
- ownership model for canonical facts derived from multiple sources;
- API error format;
- object-storage and job-queue abstractions.
