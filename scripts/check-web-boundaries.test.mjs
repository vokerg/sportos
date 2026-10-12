import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkWebSource, scanWebSources } from './check-web-boundaries.mjs';

const rules = (file, code) => checkWebSource(file, code).map((diagnostic) => diagnostic.rule);

test('allows feature-local state, models, data access and shared infrastructure', () => {
  assert.deepEqual(rules('features/daily/state/daily.store.ts', [
    "import { pollDurableJob } from '../../../core/jobs/durable-job-poller';",
    "import { DailyApi } from '../data-access/daily-api.service';",
    "import type { DailyModel } from '../model/daily.models';",
  ].join('\n')), []);
  assert.deepEqual(rules('features/daily/ui/daily-card.component.ts',
    "import type { DailyModel } from '../model/daily.models';"), []);
  assert.deepEqual(rules('core/jobs/poll.ts', "import { config } from '../config/api-base';"), []);
});

test('rejects core and shared dependencies on features', () => {
  assert.deepEqual(rules('core/auth/session.ts', "import '../../features/daily/model/daily.models';"),
    ['infrastructure-boundary']);
  assert.deepEqual(rules('shared/util/format.ts', "export * from '../../features/daily/model/daily.models';"),
    ['infrastructure-boundary']);
});

test('rejects direct dependencies between feature slices (including dynamic import)', () => {
  assert.deepEqual(rules('features/daily/state/daily.store.ts',
    "import type { Provider } from '../../providers/model/provider.models';"), ['feature-boundary']);
  assert.deepEqual(rules('features/daily/pages/daily-page.ts',
    "const lazy = import('../../providers/pages/provider-page.component');"), ['feature-boundary']);
});

test('rejects component and presentation imports into feature state', () => {
  assert.deepEqual(rules('features/daily/state/daily.store.ts',
    "import { DailyPage } from '../pages/daily-page.component';"), ['state-boundary']);
  assert.deepEqual(rules('features/daily/state/daily.store.ts',
    "import { DailyCard } from '../ui/daily-card';"), ['state-boundary']);
});

test('rejects state and presentation imports into data-access', () => {
  assert.deepEqual(rules('features/daily/data-access/daily-api.ts',
    "import { DailyStore } from '../state/daily.store';"), ['transport-boundary']);
  assert.deepEqual(rules('features/daily/data-access/daily-api.ts',
    "export * from '../ui/daily-card.component';"), ['transport-boundary']);
});

test('prevents HttpClient injection imports in components and HTTP in UI', () => {
  assert.deepEqual(rules('features/daily/pages/daily-page.component.ts',
    "import { HttpClient as Client, HttpErrorResponse } from '@angular/common/http';"), ['component-http']);
  assert.deepEqual(rules('features/daily/ui/daily-card.component.ts',
    "import { HttpErrorResponse } from '@angular/common/http';"), ['ui-http']);
  assert.deepEqual(rules('features/daily/data-access/daily-api.service.ts',
    "import { HttpClient } from '@angular/common/http';"), []);
});

test('does not treat comments or string literals as imports', () => {
  assert.deepEqual(rules('features/daily/ui/test.component.ts',
    "// import { HttpClient } from '@angular/common/http';\nconst text = \"import '../../providers/store'\";"), []);
});

test('scan finds real repository sources and returns deterministic diagnostics', () => {
  const { files, violations } = scanWebSources();
  assert.ok(files > 0);
  assert.deepEqual(violations, []);
});
