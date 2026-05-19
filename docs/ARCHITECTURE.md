# Architecture

## Goal

Replace spreadsheet formulas with a canonical, auditable data system while keeping spreadsheet import/export compatibility.

```txt
XLSX / Google Sheets / Strava / Garmin / FIT / manual input
                         ↓
             raw source_records with provenance
                         ↓
              normalized canonical entities
                         ↓
          deterministic scoring and analytics
                         ↓
            Angular tables, dashboards, AI tools
```

## Layers

### Raw provenance

Tables:

- `import_batches`
- `source_records`

Every imported row is stored before normalization. This lets us debug weird cells, re-run normalization, and keep history.

### Canonical facts

Tables:

- `activities`
- `daily_metrics`
- `performance_events`

These are the app's real domain model.

### Rules and explanations

Tables:

- `scoring_rules`
- `score_ledger`

Every official point should be traceable to one rule and one calculation payload.

### Read models

Views:

- `v_daily_summary`
- `v_score_breakdown`
- `v_performance_events`

The future AI layer should query these read models, not raw tables.

## Why Flyway + Kysely

Flyway owns schema evolution through SQL migrations. Kysely is only the typed query layer for application code.

## Why not AI first

The spreadsheets currently combine raw facts, formulas, coefficients, achievements, and views. Adding an LLM before separating these layers would make the system harder to trust.
