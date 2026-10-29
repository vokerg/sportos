# Athlete chat

Open **Chat** in the web menu (`/chat`). Ask a question about retained training,
follow up in the same conversation, and expand **Official evidence** to inspect
the exact tool input and deterministic result behind a citation. The previous
Daily score analysis remains at `/analysis` and is linked from Chat.

The API hosts the existing five athlete MCP tools over an in-memory SDK transport.
This does not expose a public MCP listener or use the operator's local MCP account
binding. Each request constructs an athlete read service bound exclusively to the
normal authenticated session account. The existing MCP input/output validation,
non-owner role assertion, account context, read-only transactions, provenance and
separate retained-detail database policy remain in force. There are no provider
fetches, canonical changes or score writes. Both browser session/CSRF and native
session enforcement use the existing global guard.

## Server configuration

```dotenv
SPORTOS_AI_CHAT_ENDPOINT=https://api.deepseek.com/chat/completions
SPORTOS_AI_MODEL=deepseek-flash
SPORTOS_AI_API_KEY= # set privately in the server environment
SPORTOS_AI_TIMEOUT_MS=60000
```

Use the model available to your provider account. The endpoint is an explicit full
chat-completions URL, using HTTPS except on localhost. Embedded credentials,
queries, fragments and redirects are rejected. The model/key/timeout settings are
shared with the older optional JSON generator; leave `SPORTOS_AI_JSON_ENDPOINT`
empty unless running that separate custom gateway protocol. Chat uses the direct
OpenAI-compatible protocol, JSON output and DeepSeek non-thinking mode. Restart
the API launcher after changing `.env`. No key is sent to the browser.

Leaving the chat endpoint empty disables external generation. Provider failures,
timeouts, incomplete output, unsupported tools, schema violations, oversized
results or unknown citations produce an explicitly labelled safe fallback. Any
already-read evidence remains inspectable. Daily score analysis remains available
without an external model.

## Bounds and privacy

- Questions: 1–2,000 characters. Context: at most six prior user/assistant messages,
  each at most 6,000 characters. The browser retains at most 20 turns in page
  memory; clearing or leaving the page discards them. Nothing goes to localStorage.
- At most four tool calls across three model tool rounds, then a final JSON answer. If tool mode returns prose or invalid
  structure, one JSON-mode formatting pass is permitted within the same deadline;
  the result still undergoes full citation and shape validation.
  Tool schemas enforce fixed dates, fields, pagination and resource limits. The
  snapshot is projected to explicitly labelled lifetime/window summaries, existing
  deterministic adjacent comparisons and three
  activity examples per list, retaining units, source policy, coverage and caveats;
  omitted historical/profile detail requires focused tool reads. The model must
  quote provided numeric values rather than calculate new numbers. Up to
  120,000 bytes of evidence and 262,144 bytes per model response are accepted.
- A 1–60 second model deadline applies across calls. Each existing database read
  has its own 20-second statement timeout. One active question and ten requests per
  minute per account, with at most 20 concurrent chats per API process. These are
  process-local protections, not a distributed quota service. Browser cancellation
  stops the pending HTTP subscription; server work can continue until its deadline.
- Observations must cite exact `evidence:N` keys from successful reads in the
  current turn. Greetings and clarifying questions can omit reads, but must
  have an empty observations section. Previous conversation text is untrusted context and never supplies
  official evidence. Each of three generated sections has at most eight items of
  at most 600 characters. Guidance remains distinct from official results.
- External generation receives the question, bounded history and allowlisted MCP
  evidence only. MCP results omit owner IDs, narrative/source metadata, raw bodies,
  routes, provider credentials and storage internals. The provider is intentionally
  authorized to process those private metrics when configured.
- Audit uses existing append-only `analysis_runs`: `tool_name` is null, with
  `operation: athlete_chat`, tool names, history count, question hash, citation keys,
  model metadata and outcome. No prompts, answers, history, tool payloads or model
  error bodies are persisted or logged. Hosted fallback telemetry contains only a
  fixed stage, allowlisted tool/error code and optional five-character SQLSTATE;
  it excludes error objects and messages. Invalid/missing tool evidence may be
  corrected within the existing four-call budget. No database migration is required.

SportOS chat explains retained evidence. Training plans, race forecasts and health
diagnoses remain outside this surface. Citation checks validate evidence references;
they cannot guarantee every natural-language interpretation is correct.
