# Angular frontend architecture

## Status

This document defines the target architecture for `apps/web`. It is the baseline for new substantial Angular work and for the incremental migration tracked in issues #74-#80.

The current application is intentionally not being reshuffled in one pass. Existing flat files under `apps/web/src/app` remain valid until the queue item that owns their migration changes them. New feature work should follow the target boundaries below rather than adding more root-level feature files or expanding the global `ApiService`.

## Goals

The frontend should make four responsibilities explicit:

1. application-wide infrastructure is owned by `core/`;
2. reusable, application-agnostic presentation and utilities are owned by `shared/`;
3. product workflows are owned by feature slices under `features/`;
4. routed page components remain thin and delegate durable workflow state to feature-scoped state/facade classes.

SportOS does not need NgRx. Angular signals, focused injectable facades/stores, RxJS at asynchronous boundaries, and small pure model helpers are sufficient.

## Target layout

```text
apps/web/src/app/
  app.component.ts
  app.routes.ts
  app.config.ts                 # application bootstrap providers; introduced by #74

  core/
    auth/                       # session bootstrap, sign-in/out, auth expiry
    config/                     # API base token/configuration
    http/                       # interceptors and HTTP-wide infrastructure
    jobs/                       # generic durable-job polling/cancellation; introduced by #75

  shared/
    ui/                         # reusable presentational components
    model/                      # truly cross-feature, UI-safe types
    util/                       # pure reusable helpers

  features/
    daily/
      pages/
      state/
      data-access/
      model/
      ui/
    imports/
      pages/
      state/
      data-access/
      model/
      ui/
    providers/
      pages/
      state/
      data-access/
      model/
      ui/
    monthly-stats/
      pages/
      state/
      data-access/
      model/
      ui/
    dynamics/
      pages/
      state/
      data-access/
      model/
      ui/
```

A feature does not have to create every directory. Add a layer only when the feature has code that belongs there. Small features may consist of a page, a data-access client, and a model helper without an otherwise empty state or UI layer.

## Layer responsibilities

### `pages/`

Pages are route-level composition components.

Pages may:

- read route and query parameters;
- provide/inject the feature state facade;
- bind signals and view models to feature UI components;
- translate UI events into feature intents;
- coordinate navigation.

Pages should not own durable polling loops, multi-request workflow orchestration, HTTP translation, or large domain transformations. A page can perform a trivial one-shot read directly through feature data access when introducing a store would add no value, but once cancellation, stale-response protection, durable jobs, multiple dependent calls, or reusable workflow state appear, move that orchestration to `state/`.

### `state/`

State owns feature workflow orchestration.

Prefer a small injectable signal-based facade/store when the feature has one or more of:

- multiple dependent API calls;
- loading/error/terminal workflow state shared by several UI elements;
- cancellation or stale-response protection;
- durable-job polling;
- retry/cancel flows;
- state that survives child-component replacement inside the route;
- non-trivial coordination between route/query state and remote data.

Feature state may depend on its feature `data-access/`, feature `model/`, and generic `core/` infrastructure such as durable-job polling. It must not import Angular components. It should expose state and intent methods rather than DOM concerns.

Feature stores should normally be scoped to the route/page through providers. Use `providedIn: 'root'` for genuine application-wide singletons, not merely because injection is convenient.

Do not introduce NgRx for these workflows.

### `data-access/`

Data access owns transport concerns for one feature:

- `HttpClient` calls;
- API URL construction through the centralized core configuration;
- request/response transport contracts when they are feature-specific;
- transport-to-feature-model translation;
- safe normalization of HTTP errors into feature-consumable results where useful.

Data-access code must not depend on UI components or feature state. UI components must not inject `HttpClient`.

Do not add new feature methods to a global catch-all API service. Existing `ApiService` methods migrate incrementally under #77.

### `model/`

Model code contains feature-owned types and pure transformations:

- view-model builders;
- date/range normalization specific to the feature;
- pure selectors/presenters;
- feature API/domain types that are reused by state and UI.

Model code should remain framework-light. Pure helpers should not inject services or depend on components.

### `ui/`

UI contains focused presentational components.

UI components receive data through inputs and emit user intents through outputs. Local ephemeral interaction state is fine. They do not own HTTP calls, durable polling, cross-component workflow state, or page navigation policy.

A component that begins coordinating remote workflows is no longer merely presentation and should push that responsibility up to feature state or the page.

## Dependency direction

The normal direction is:

```text
app shell/routes
      |
      v
feature pages ---> feature ui
      |
      v
feature state
      |
      v
feature data-access
      |
      v
core HTTP/config/jobs

feature pages/state/ui ---> feature model
feature code -----------> shared
core -------------------> shared pure utilities only when useful
```

Required rules:

- pages -> state -> data-access;
- pages/state/UI -> feature model as needed;
- features may depend on `shared/`;
- `shared/` must not depend on features;
- `core/` must not depend on features;
- data access must not depend on UI;
- state must not depend on Angular components;
- presentation components must not inject `HttpClient`;
- avoid feature-to-feature deep imports. If two features truly share a concept, extract the smallest stable concept to `shared/` or define an explicit public boundary instead of reaching into another feature's internals.

## Core ownership

Application-wide infrastructure belongs in `core/`:

- authentication/session state -> `core/auth/`;
- API base configuration/injection token -> `core/config/`;
- authentication/CSRF interceptors and generic HTTP infrastructure -> `core/http/`;
- generic durable-job polling and cancellation -> `core/jobs/`.

Bootstrap and API-base configuration is centralized by the #74 pattern:

- `app.config.ts` owns application bootstrap providers; keep `main.ts` limited to bootstrapping `AppComponent` with that configuration.
- `core/config/api-base.ts` defines the single `SPORTOS_API_BASE` injection token and the local-development default.
- HTTP clients inject `SPORTOS_API_BASE` directly. A feature API client must not inject `ApiService`, `WebAuthService`, or another feature service merely to discover the API URL.
- `core/http/auth-http.interceptor.ts` consumes the same token when deciding whether credentials, CSRF headers, and auth-expiry handling apply. Never attach SportOS credentials to a request whose origin does not match the configured API base.
- The root HTTP/origin exports are compatibility shims only. New infrastructure imports should target `core/http/` directly.

For tests or a different browser deployment, override the `SPORTOS_API_BASE` provider at the application/test injector boundary. Do not introduce feature-local hard-coded origins or a second runtime-configuration mechanism.

Issue #75 owns the generic durable-job polling abstraction. Until it lands, do not create a second "generic" polling utility in another feature. Feature-local polling needed by active product work should remain narrow and be an explicit migration target for #75.

## Concrete example: a new Activities feature

A substantial Activities workflow should start approximately as:

```text
features/activities/
  pages/
    activities-page.component.ts
    activity-detail-page.component.ts
  state/
    activities.store.ts
  data-access/
    activities-api.service.ts
  model/
    activity.models.ts
    activity.view-model.ts
  ui/
    activity-list.component.ts
    activity-summary.component.ts
```

`app.routes.ts` should lazy-load the page entry point. The page injects `ActivitiesStore`; the store calls `ActivitiesApiService`; the API client owns HTTP translation; presentational components only render inputs and emit intents.

Do not place `activities-page.component.ts`, `activities-api.service.ts`, and all activity models back at the root of `src/app`.

## Incremental migration

Migration is deliberately issue-scoped:

- #74: bootstrap and API configuration -> `app.config.ts`, `core/config/`, `core/http/`; use the established `SPORTOS_API_BASE` token for all SportOS HTTP clients;
- #75: durable-job polling -> `core/jobs/`;
- #76: Daily orchestration -> `features/daily/state/` and related feature layers;
- #77: global API methods/contracts -> feature `data-access/` and `model/`;
- #78: Providers and Imports orchestration -> feature state;
- #79: reusable analytics range/query behavior -> `shared/` where semantics are genuinely common;
- #80: fast architecture guardrails and focused test guidance.

Do not mass-move unrelated files for cosmetic consistency. When an issue materially changes an existing feature, move only the files that are part of that issue's responsibility and update imports/tests in the same change.

New substantial product features should use the target layout immediately, even while older features remain flat.

## Parallel product and architecture work

The architecture lane must not freeze unrelated product work.

Before editing:

1. check issue #3 and open PRs;
2. identify which feature and infrastructure files the active work owns;
3. avoid a second PR that substantially rewrites the same page/store/API client;
4. if product work needs a pattern currently being introduced by an architecture PR, either build on the merged pattern or keep the product change narrow and document the migration point.

Architecture work that touches `main.ts`, `app.config.ts`, shared routes, central API configuration, or generic job infrastructure has a larger collision radius than a feature-local change. Prefer one active owner for those files at a time.

## Validation policy

Use the smallest evidence that matches the frontend change.

For a focused feature change:

```bash
pnpm --filter @sportos/web test -- <relevant-test-file>
pnpm --filter @sportos/web typecheck
```

Run the web build when templates, lazy routes, application providers, or bundling integration changed:

```bash
pnpm --filter @sportos/web build
```

A documentation-only frontend architecture change does not require database, worker, importer, or backend integration suites.

Run broader root validation only when the change crosses package/runtime boundaries, changes shared contracts consumed outside the web app, or focused evidence is insufficient:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Do not routinely run migrations, database integration, worker suites, importer suites, or the full repository CI matrix for frontend-only refactors.

## Agent checklist

When adding or changing Angular code:

- decide whether the code is application infrastructure, shared reusable code, or feature-owned code;
- put new feature code under `features/<feature>/`;
- keep route pages thin;
- use feature-scoped signal state for real orchestration, not for every component;
- keep HTTP in data access;
- keep durable polling out of components;
- keep pure transformations in model helpers;
- keep presentational UI free of feature workflow dependencies;
- avoid new global service/model dumping grounds;
- run targeted frontend tests and typecheck first;
- update this document when a reusable frontend pattern changes.
