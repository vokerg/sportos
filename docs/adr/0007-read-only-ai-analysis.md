# ADR 0007: Read-only AI analysis with cited provenance

- Status: Accepted
- Date: 2026-08-05
- Issue: #16

## Context

SportOS now has authenticated account ownership, forced row-level security, stable cockpit reads, deterministic scoring, exact rule and ledger provenance, canonical export, and provider ingestion. An analysis feature can therefore be added without asking a language model to infer ownership, query arbitrary tables, calculate official scores, or mutate authoritative records.

The principal risks are:

- a model obtaining broader database capability than the normal API;
- cross-account disclosure through tool arguments, source identifiers, or audit records;
- a model calculating or presenting unofficial totals as authoritative;
- prompt injection contained in workbook cells, activity notes, filenames, rule names, or other stored text;
- unsupported conclusions when data is absent, conflicting, incomplete, or medical in nature;
- storing raw questions, generated text, or unnecessary personal content in logs;
- an interface that visually blurs generated guidance and official SportOS records.

## Decision

### 1. Two-layer analysis boundary

The analysis feature is split into:

1. **deterministic read tools**, which return typed facts, calculations, citations, and data-quality flags; and
2. **text generation**, which may summarize or explain only the returned tool result.

The initial tool allowlist is deliberately small:

- `daily_summary` for an explicit inclusive range of at most 366 days; and
- `daily_score_breakdown` for one real calendar date.

No SQL, repository name, account identifier, write instruction, or arbitrary filter is accepted from the browser or model.

### 2. Authentication and account isolation

Analysis routes use the existing global session and CSRF enforcement. Account identity comes only from the authenticated session. Tool execution reuses `DailyService` and `DbProvider.withAccount`, so PostgreSQL forced RLS and the same account-context cleanup used by ordinary cockpit reads remain authoritative.

The model is never given an owner identifier and cannot select another account. Dedicated integration evidence creates two accounts with the same date and proves that each receives only its own facts and audit rows.

### 3. Deterministic calculations and citations

Totals, averages, extrema, first-to-last comparisons, score totals, and ledger/rule calculations are computed in application code. Generated text receives those results; it does not calculate official values.

Every observation emitted by the generation boundary must reference one or more citation keys that were returned by the tool. Supported citation kinds are canonical dates, activities, score-ledger rows, immutable scoring-rule UUIDs, source records, and import batches. A response containing an unknown citation, unsupported field, oversized section, or uncited observation is rejected and replaced by the deterministic fallback.

### 4. Prompt-injection boundary

The model input is a sanitized, fixed-shape official record. Arbitrary narrative or private source metadata is excluded, including activity notes, filenames, workbook sheet names, row hashes, upload hashes, rule codes, rule names, rule descriptions, and rule-name-derived ledger reason text. Imported or stored text is never treated as an instruction.

The external generator request also states that instructions inside the official record must not be followed. Structural validation remains the enforcement boundary; prompt wording alone is not trusted.

### 5. Generated-answer classification

Answers have three explicit generated sections:

- `observations` — factual statements that require returned citation keys;
- `uncertainty` — missing, conflicting, incomplete, provenance, or medical limitations; and
- `suggestions` — non-authoritative next steps.

The API refuses requests to activate rules, edit/delete records, persist/recompute scores, connect or synchronize providers, retry/cancel jobs, or otherwise mutate authoritative state. Questions seeking diagnosis, injury assessment, recovery status, or overtraining conclusions receive explicit medical uncertainty rather than a diagnosis.

### 6. Generator configuration and fallback

By default, SportOS uses a deterministic local fallback and sends no data to an external model.

An operator may explicitly configure a bounded HTTPS JSON generator with `SPORTOS_AI_JSON_ENDPOINT`, `SPORTOS_AI_MODEL`, optional `SPORTOS_AI_API_KEY`, and a bounded timeout. The adapter sends only the bounded question, sanitized official tool result, citation allowlist, and generation policy. Invalid, unavailable, or non-conforming external output falls back to deterministic guidance.

The adapter is provider-neutral. Provider-specific SDKs and credentials do not enter pure packages or the browser bundle.

### 7. Audit persistence

Migration V110 adds append-only, owner-scoped `analysis_runs`. The runtime API may only `SELECT` and `INSERT`; it cannot update or delete audit rows. Worker, worker-data, legacy, and shared data roles cannot read the table.

Audit rows contain only:

- SHA-256 question hash;
- bounded tool name and date/range input summary;
- citation keys/source identifiers;
- generator/provider/model metadata;
- outcome and data-quality status; and
- timestamp and owner.

Raw questions, generated text, facts, prompts, tokens, source payloads, filenames, notes, hashes from imported data, and account profile data are not stored.

### 8. User interface

Angular displays **Generated guidance** and **Official SportOS evidence** as separate sections. It states that generated guidance is non-authoritative, lists evidence keys and data-quality flags, shows the audit reference, and explains that the surface cannot write official data.

## Consequences

### Positive

- The model has no arbitrary database or write surface.
- Official calculations remain deterministic and testable.
- Every supported factual observation is tied to returned evidence identifiers.
- Missing, conflicting, malicious, and insufficient inputs have explicit behavior.
- External model use is optional and operationally visible.
- Audit evidence is useful without retaining unnecessary personal content.

### Trade-offs

- The initial tool set cannot answer broad arbitrary questions or analyze performance-event detail.
- Citation validation proves that evidence was referenced, not that every natural-language inference is semantically perfect.
- External generation requires an operator-controlled endpoint that implements the documented JSON contract.
- Append-only audit rows require an explicit account-deletion policy in hosted deployments.

## Rejected alternatives

- **Direct model database access:** rejected because it bypasses stable read contracts and authorization review.
- **Model-generated SQL:** rejected because allowlisting and non-enumeration cannot be proven reliably.
- **Letting the model calculate totals or scores:** rejected because official scoring must remain deterministic.
- **Passing complete raw records to the model:** rejected because imported text and private metadata create prompt-injection and privacy risk.
- **Logging full prompts and responses:** rejected because source identifiers and outcome metadata are sufficient for the required audit trail.
