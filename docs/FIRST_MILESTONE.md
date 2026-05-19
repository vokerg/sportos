# MVP-0: spreadsheet ingestion and explainable daily scores

## Delivered in this starter

- Docker Compose with Postgres, Redis, Flyway
- Flyway migrations for import, activity, scoring, performance, and summary views
- TypeScript domain model
- Deterministic scoring engine
- XLSX importer skeleton using SheetJS
- `my_sport.xlsx` daily ledger mapper
- running workbook performance mapper
- NestJS API endpoints
- Angular dashboard shell with AG Grid and ECharts
- CLI importer

## Not delivered yet

- Browser upload flow
- Background job queue
- Auth/user accounts
- Strava/Garmin integration
- Rules Studio UI
- AI analyst
- XLSX export

## Suggested next PRs

1. Add score-breakdown API endpoint for a single date.
2. Add Daily Log expandable row showing `score_ledger`.
3. Add editable `scoring_rules` grid.
4. Tune historical coefficients against the imported Excel `All` column.
5. Add browser file upload and make imports async.
