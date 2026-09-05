# MVP-0: spreadsheet ingestion and explainable daily scores

## Objective

Prove that SportOS can repeatedly import supported training workbooks, preserve source rows, normalize known facts, calculate deterministic daily scores, and explain differences from imported spreadsheet totals.

MVP-0 is a trust and data-quality milestone. It is not a hosted product milestone.

## Implemented trust boundary

The repository now contains:

- clean workspace project-reference validation and a regenerated pnpm lockfile;
- fresh-database Flyway migration validation;
- sanitized XLSX fixtures for supported daily-ledger and running layouts;
- conservative parser behavior for unknown/malformed data;
- transactional and idempotent import orchestration;
- source-record links for canonical activities, daily metrics, and performance events;
- durable import history, affected dates, transitions, warnings, errors, and row diagnostics;
- persisted deterministic score totals and ordered ledger entries;
- a score-breakdown API and Daily Log reconciliation workflow;
- explicit scoring units, rounding, thresholds, effective dates, priorities, and base/bonus classification;
- a deterministic reconciliation report with exact, explained, unresolved, and non-comparable outcomes;
- machine-readable fixture evidence grouped by status, delta magnitude, activity type, and evidence-backed likely rule.

## MVP-0 exit criteria and evidence

1. **Repeatable setup**: the documented setup uses pinned Node/pnpm versions, the committed lockfile, a disposable Neon branch/database, and append-only migrations.
2. **Reproducible CI**: CI performs frozen installation, fresh migration, typecheck, all unit/UI tests, database importer integration, production build, and cleanup.
3. **Fixture coverage**: synthetic XLSX files represent every supported daily-ledger header and confirmed performance-sheet mapping, including hidden/helper and ambiguous data.
4. **Import traceability**: canonical rows retain source-record and import-batch references where applicable; privacy-safe read models omit raw payloads and paths.
5. **Idempotency and transactions**: identical imports converge on the same canonical identifiers, and forced failures roll back every import phase.
6. **Explainable reconciliation**: a date exposes imported spreadsheet total, app total, delta, base/bonus totals, ordered ledger entries, complete rule configuration, and source provenance.
7. **Scoring semantics**: coefficient units, one-round-per-rule behavior, strict threshold boundaries, inclusive effective periods, deterministic ordering, and activity-level achievements are tested and documented.
8. **Conservative coefficient reconciliation**: current configured coefficients are retained unless evidence justifies a change; formula components are compared directly, default tolerance is zero, and unresolved behavior remains labeled rather than fitted.
9. **Failure visibility**: import status, failure phase, warning/error counts, source-row diagnostics, and retry guidance are available through API and web workflows.
10. **Documented assumptions**: workbook mappings, scoring formulas, migration impact, tolerance policy, and unresolved ambiguities are recorded in `SPREADSHEET_MAPPING.md` and `SCORING_RULES.md`.

## Reconciliation evidence

The sanitized report in `docs/evidence/scoring-reconciliation.fixture.json` contains:

- an exact total with exact run, bike, and swim formula components;
- explicit unmapped SUP and rowing components rather than guessed rules;
- an explained difference equal to an activity-linked SportOS achievement bonus excluded from the spreadsheet total;
- an unresolved bike-component mismatch identifying only the directly implicated rule;
- a non-comparable row where the workbook has no cached numeric `All` value.

This proves application semantics and report shape. It does not prove that every personal historical workbook used the current bike/swim coefficients or the same `WOtotal` composition.

## Historical correction policy

Migration V102 preserves configured coefficients and effective periods. It conservatively:

- removes legacy achievement ledger entries that have no canonical `activity_id`, because those entries were produced from synthetic daily aggregates;
- adjusts affected persisted bonus/total values by the removed entries;
- moves legacy power points from the base bucket to the bonus bucket without changing total points;
- enriches remaining legacy ledger JSON with rule classification and effective metadata.

No broad historical coefficient recomputation is performed. Dates requiring fully enriched raw/rounded inputs should be explicitly recomputed or re-imported with the current engine.

## Deferred until after MVP-0

- browser upload and durable storage;
- asynchronous import jobs;
- editable/versioned Rules Studio and audited recomputation;
- complete cockpit drill-downs and canonical export;
- authentication and user ownership;
- provider synchronization;
- read-only AI analysis.

The authoritative implementation order is maintained in GitHub issue #3. The next milestone begins with browser upload and the durable file-storage boundary.
