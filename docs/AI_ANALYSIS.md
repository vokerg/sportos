# Read-only analysis operations

SportOS analysis is an authenticated, account-scoped explanation layer over canonical read models. It cannot edit activities, activate rules, persist scores, connect providers, or operate jobs. Official calculations remain deterministic application output.

See [ADR 0007](adr/0007-read-only-ai-analysis.md) for the accepted security and architecture decision.

## Browser workflow

After sign-in, open **Analysis**. Choose either:

- **Daily range** — explicit `from` and `to` dates, at most 366 days; or
- **Score breakdown** — one real `YYYY-MM-DD` date.

Enter a question of at most 500 characters. The result displays:

1. **Generated guidance** split into observations, uncertainty, and suggestions; and
2. **Official SportOS evidence** with data-quality flags, exact citation keys, and an audit reference.

Requests to change authoritative data are refused. Missing data returns `insufficient_data`. Questions seeking a diagnosis or recovery/overtraining conclusion receive an explicit medical limitation.

## API routes

Both routes are authenticated and require the normal CSRF header because they use `POST`.

```text
POST /analysis/tools/execute
POST /analysis/answers
```

Tool-only request:

```json
{
  "tool": "daily_summary",
  "input": {
    "from": "2026-05-01",
    "to": "2026-05-31",
    "limit": 31
  }
}
```

Answer request:

```json
{
  "question": "What changed during May?",
  "tool": "daily_summary",
  "input": {
    "from": "2026-05-01",
    "to": "2026-05-31",
    "limit": 31
  }
}
```

The browser never sends an owner ID. Unsupported fields and ambiguous date ranges are rejected before repository execution.

## Generator modes

### Deterministic fallback

This is the default. Leave `SPORTOS_AI_JSON_ENDPOINT` and `SPORTOS_AI_MODEL` empty. No question or SportOS record is sent outside the API process. The fallback produces bounded text from deterministic tool results and data-quality flags.

### External JSON generator

External generation is explicit opt-in:

```dotenv
SPORTOS_AI_JSON_ENDPOINT=https://model-gateway.example.com/sportos-analysis
SPORTOS_AI_MODEL=approved-model-name
SPORTOS_AI_API_KEY=
SPORTOS_AI_TIMEOUT_MS=15000
```

HTTPS is required except for `localhost` or `127.0.0.1` development. The timeout must be 1,000–60,000 milliseconds. The API key is sent as a Bearer token and must remain in server-side deployment secrets.

The endpoint receives a JSON request with:

- schema version `sportos.analysis-generation.v1`;
- configured model name;
- bounded user question;
- sanitized official tool result;
- allowed citation keys; and
- read-only generation policy.

It must return this exact top-level JSON shape:

```json
{
  "observations": [
    {
      "text": "A factual observation supported by returned evidence.",
      "citationKeys": ["daily_metric:2026-05-18"]
    }
  ],
  "uncertainty": [
    {
      "text": "A limitation or unresolved conflict.",
      "citationKeys": []
    }
  ],
  "suggestions": [
    {
      "text": "A non-authoritative next step.",
      "citationKeys": []
    }
  ]
}
```

Each section may contain at most eight items. Text is bounded to 600 characters per item. Observations require at least one citation when evidence exists. Every citation key must belong to the supplied allowlist. Extra fields, unknown citations, invalid JSON, oversized responses, timeouts, and non-success HTTP responses cause deterministic fallback.

## Data sent to an external generator

The configured endpoint receives only the bounded question and sanitized official read result. The tool boundary excludes:

- raw workbook cells and formulas;
- raw provider payloads;
- activity notes;
- filenames and storage paths;
- sheet names and row indexes;
- upload/source hashes;
- rule codes, names, and descriptions;
- rule-name-derived ledger reason text;
- authentication/session material;
- provider tokens or encrypted envelopes; and
- account IDs or profile data.

Operators remain responsible for the external endpoint's retention, regional processing, access control, and vendor terms. Leave external generation disabled when those controls are not acceptable.

## Audit records

`analysis_runs` is append-only for `sportos_app` and protected by forced RLS. It stores the account owner internally, but public answers expose only the generated audit UUID.

Stored audit metadata is limited to the SHA-256 question hash, tool/date input summary, citation keys, generator/provider/model metadata, outcome, data-quality status, and timestamp. Raw questions and generated answers are not stored.

## Validation

The root CI includes:

- fresh migration through V110;
- populated V105-to-V110 upgrade;
- typecheck and all unit/UI tests;
- dedicated cross-account analysis integration;
- existing database/worker/importer integrations; and
- production build.

Evaluation cases cover missing data, conflicting comparison totals, incomplete provenance, ambiguous ranges, imported-text prompt injection, invalid citations, unsupported authoritative writes, and medical conclusions.
