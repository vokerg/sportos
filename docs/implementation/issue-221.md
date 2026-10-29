# Issue #221: web athlete chat

The maintainer requested a working local chat after the athlete MCP delivery,
including direct model infrastructure and local configuration. The former Analysis
menu led to a manually scoped daily form. Chat now lives at `/chat`; that daily
form remains at `/analysis` and is linked from Chat.

## Investigation

Inspected before implementation: AGENTS.md, README.md,
docs/{ARCHITECTURE,ROADMAP,AUTHENTICATION,AI_ANALYSIS,FRONTEND_ARCHITECTURE,ATHLETE_MCP}.md,
ADR 0007; apps/mcp/src/{server,service,runtime,contracts,server.test}.ts;
apps/api/src/{app.module,db.provider,main,hosted-config}.ts, analysis contracts,
controller, validation, model, tools, service and existing tests; authentication
controller and global session guard; packages/db/src/analysis-schema.ts,
repositories/analysis-audit.repository.ts and V110; web shell, routes, analysis
panel/client/tests; package/TS/dev configuration. Reviewed open issues/PRs, claims
and recent merges, including completed #211/#212. Inspected the sibling
OpenAI-compatible provider and environment variable names without exposing keys.
During validation also inspected Dockerfile, CI, hosted startup, MCP output
schemas and dev-supervisor behavior.

The mismatch was functional scope, not an unfinished MCP dependency: #211 is
merged, but daily analysis did not host the athlete tools or understand direct
chat-completions APIs. No schema migration is needed for this upgrade.

## Implementation

- Export a side-effect-free MCP library entry and host the existing server over
  an in-memory SDK transport, with the owner bound from the authenticated session.
- Reuse all existing strict schemas, role assertions, read-only account-bound
  transactions and retained-detail policy. No public MCP listener, operator owner
  binding, provider fetch, canonical mutation or scoring write.
- Add bounded compatible model transport, DeepSeek non-thinking configuration,
  contextual tool use, strict cited JSON validation and explicit safe fallback.
- Project the large snapshot to labelled deterministic summaries, selected
  examples, existing comparisons, units, source policy and caveats. Focused tools
  supply detailed evidence. The full MCP contract remains unchanged.
- Keep bounded conversations only in page memory, with route-scoped signal state,
  cancellation/stale-response protection, duplicate-send prevention and retry.
- Keep audit rows limited to hashes, bounded operation/tool/count metadata,
  citations and model/outcome metadata. Existing append-only/RLS grants apply.
- Include the MCP dependency manifest in the Docker install layer and watch MCP
  build output in local API development. Document configuration in CHAT.md.

## Validation

Passed locally:

- API typecheck; 27 focused chat, projection, controller, analysis and evaluation
  tests. Tests cover session-account binding, prohibited owner/tool inputs,
  citation rejection, bounded responses/history, disabled model, provider failure,
  redacted audit, concurrency and clarification without fabricated observations.
- MCP unit/transport tests: 9 passed. Seven synthetic database/detail integration
  cases were skipped because their dedicated test database URLs were not supplied.
- Web typecheck and production build; 5 chat-state/existing-analysis tests.
- Angular architecture checks and 8 checker tests; 4 dev-supervisor tests.
- Backend build; isolated production `pnpm deploy --prod` API import probe.
- Browser layout/menu inspection, write-refusal and New chat clearing.
- Private local live direct-provider probe, monthly volume comparison and compact
  athlete overview: successful external generation and valid returned citations.
  The API launcher was restarted to load the local settings. No private questions,
  responses, metrics, identifiers, key material or local artifact paths are recorded
  in this document or GitHub.

No fresh/populated migration, full repository matrix or full Docker image build
was run; there are no schema changes and the relevant production package imports
were checked. Existing dedicated MCP integration remains the database isolation
regression gate. Model semantic correctness is not guaranteed by citation checks.
Server-side work may continue after browser cancellation until its bounded
deadline; process-local quotas are not distributed rate limiting.

Local configuration is in the ignored, permission-restricted `.env`; it is not
part of the PR. No merge is authorized by this implementation request. The issue
remains open pending review and an explicitly authorized merge.
