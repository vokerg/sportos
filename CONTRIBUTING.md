# Contributing

SportOS handles personal training data and replaces spreadsheet calculations with an auditable domain model. Changes should favor traceability, deterministic behavior, and conservative interpretation over convenience.

## Development environment

Use:

- Node.js 22
- pnpm 9.12.0
- a Neon PostgreSQL project and branch
- Flyway CLI 10 or newer on `PATH`

Install and validate from the repository root:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
```

Use pnpm exclusively. Do not commit `package-lock.json`, `yarn.lock`, framework caches, build output, local environment files, or personal workbook data.

## Repository boundaries

- `packages/domain` contains pure business rules and should not depend on databases or UI frameworks.
- `packages/importers` owns workbook interpretation and warnings.
- `packages/db` owns typed persistence queries, not schema migration.
- `flyway/sql` owns database evolution.
- `apps/api` owns HTTP validation and orchestration.
- `apps/web` renders canonical data and must not become the only implementation of scoring logic.
- `apps/worker` runs local or future background imports.

Keep dependencies pointing toward shared, pure packages. Avoid importing application code into domain packages.

### TypeScript workspace builds

Node packages and applications are TypeScript composite projects connected through project references. Keep runtime imports on workspace package names such as `@sportos/db`; do not replace them with sibling relative imports.

When adding or removing a workspace dependency:

1. update the consumer's `package.json` dependency;
2. update the consumer's `tsconfig.json` `references` list;
3. keep the provider's public surface exported through `src/index.ts`;
4. preserve `dist/index.js` and `dist/index.d.ts` as the package runtime/type entry points.

Root `pnpm typecheck` builds the referenced Node project graph from a clean checkout before running the Angular typecheck. It may create ignored `dist` and `.tsbuildinfo` output; that output is validation state, not source, and must not be committed. Use `pnpm clean` to remove referenced-project output.

## Importer changes

Workbook parsing is a high-risk boundary. An importer change should include:

1. a sanitized or synthetic fixture that represents the affected layout;
2. tests for successful normalization;
3. tests for missing, malformed, or ambiguous fields;
4. expected warnings for unsupported structures;
5. evidence that identical source rows do not create duplicates;
6. an update to `docs/SPREADSHEET_MAPPING.md` when semantics change.

Do not guess the meaning of an unknown column or sheet. Persist the raw row and report a warning until the mapping is confirmed.

Never commit real personal workbooks or unredacted exports. Test fixtures must contain synthetic or properly anonymized data.

## Scoring changes

Official scores must remain deterministic and explainable.

A scoring change should include:

- a rule or domain-level test;
- representative boundary cases;
- a clear statement about whether historical dates need recomputation;
- ledger output that identifies the applied rule and calculation inputs;
- reconciliation evidence against imported spreadsheet totals when relevant.

Generated or AI-authored text must not be the source of an official score.

## Database migrations

- Add a new ordered Flyway migration; do not rewrite a migration that may already have run.
- Prefer forward-compatible, explicit SQL.
- Add indexes for new query paths where justified.
- Document destructive or backfill operations in the PR.
- Keep Kysely schema types synchronized with the migrated schema.
- State how rollback or recovery would work, even when Flyway uses forward fixes rather than down migrations.

## API changes

- Validate and bound user-controlled query and body values.
- Keep error responses actionable and avoid leaking local filesystem details.
- Treat local-path import endpoints as development-only until uploads and job isolation exist.
- Update the README when the public endpoint surface changes.

## Pull requests

Keep a PR centered on one maintenance or product outcome. The description should cover:

- what changed;
- why the change is needed;
- which roadmap milestone or exit criterion it advances;
- user and developer impact;
- validation performed;
- known limitations or follow-up work;
- migration, privacy, or data-integrity risk where applicable.

Before requesting review:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For database or importer work, also run the relevant migration and fixture/import checks.

## Documentation

Update documentation in the same PR when changing:

- repository setup or required tools;
- architecture or package responsibilities;
- workbook mappings;
- API endpoints;
- milestone scope or completion status;
- scoring semantics;
- operational assumptions.

A source file existing is not sufficient evidence that a capability is validated or operational. Use the status vocabulary in `docs/ROADMAP.md` when describing progress.
