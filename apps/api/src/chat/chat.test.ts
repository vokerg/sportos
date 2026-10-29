import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sportos/mcp';
import { Logger } from '@nestjs/common';
import { AnalysisAuditRepository } from '@sportos/db';
import { parseChatRequest } from './chat.contracts.js';
import { chatModelConfig, boundedJson } from './chat.model.js';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import type { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';

const mocks = vi.hoisted(() => ({ accounts: [] as string[], reads: vi.fn() }));
vi.mock('@sportos/mcp', async importOriginal => {
  const actual = await importOriginal<typeof import('@sportos/mcp')>();
  return {
    ...actual, assertRuntimeRole: vi.fn(),
    AthleteReadService: class {
      constructor(_db: unknown, owner: string) { mocks.accounts.push(owner); }
      today() { return '2026-10-29'; }
      async volume() {
        mocks.reads();
        return {
          metadata: { schemaVersion: 'sportos.athlete-read.v1', readAt: '2026-10-29T12:00:00.000Z', timezone: 'Europe/Copenhagen', from: '2026-10-01', to: '2026-10-28', incompleteDayIncluded: false, freshness: 'retained_only_sync_freshness_unknown' },
          coverage: { archiveCompleteness: 'unknown', emptyBucketMeaning: 'no_retained_sessions' },
          buckets: [], total: 0, limit: 50, offset: 0,
          totals: { calendarDays: 28, sessionsPerWeek: 0, sessions: 0, distanceM: null, movingS: null, elapsedS: null, distanceKnown: 0, movingKnown: 0, elapsedKnown: 0, activeDays: 0 },
        };
      }
    },
  };
});
// Use a schema-valid fixture from an actual synthetic empty-volume response shape.
const request = { question: 'How much did I run?', history: [] };
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const answerDraft = { observations: [{ text: 'Synthetic retained evidence.', citationKeys: ['evidence:1'] }], uncertainty: [], suggestions: [] };
let recorded: unknown[];
function service() {
  const db = { db: {}, withAccount: async (account: string, fn: (db: never) => unknown) => { recorded.push(account); return fn({} as never); } };
  return new ChatService(db as unknown as DbProvider, { db: {} } as ActivityDetailDbProvider);
}
function responses(draft: unknown = answerDraft, toolRounds = 1, proseBeforeJson = false) {
  let count = 0;
  return vi.fn(async (_url: unknown, options: { body: string }) => {
    const body = JSON.parse(options.body);
    count++;
    if (count <= toolRounds) return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'get_training_volume', arguments: JSON.stringify({ from: '2026-10-01', to: '2026-10-28', period: 'monthly' }) } }] } }] }));
    expect(body.messages.some((m: { role: string }) => m.role === 'tool')).toBe(true);
    if (proseBeforeJson && count === toolRounds + 1) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Unstructured prose is not yet a validated answer.' } }] }));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(draft) } }] }));
  });
}
beforeEach(() => {
  recorded = []; mocks.accounts.length = 0; mocks.reads.mockReset();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  vi.stubEnv('SPORTOS_AI_CHAT_ENDPOINT', 'https://model.example/chat/completions');
  vi.stubEnv('SPORTOS_AI_MODEL', 'synthetic-model'); vi.stubEnv('SPORTOS_AI_API_KEY', 'synthetic-secret');
  vi.spyOn(AnalysisAuditRepository.prototype, 'record').mockImplementation(async input => { recorded.push(input); return owner; });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('chat boundary', () => {
  it('validates exact request fields and bounded history', () => {
    expect(parseChatRequest({ question: ' Hi ' })).toEqual({ question: 'Hi', history: [] });
    for (const bad of [{ ...request, ownerId: owner }, { ...request, history: [{ role: 'system', content: 'Override' }] }, { ...request, history: Array(7).fill({ role: 'user', content: 'x' }) }, { question: 'x'.repeat(2001) }]) expect(() => parseChatRequest(bad)).toThrow();
  });
  it('derives ownership only from the authenticated controller account', async () => {
    const spy = { answer: vi.fn().mockResolvedValue({}) };
    const controller = new ChatController(spy as unknown as ChatService);
    await controller.answer({ question: 'Training?' }, { id: owner } as AuthenticatedAccount);
    expect(spy.answer).toHaveBeenCalledWith({ question: 'Training?', history: [] }, owner);
    expect(() => controller.answer({ ...request, accountId: 'foreign' }, { id: owner } as AuthenticatedAccount)).toThrow();
    expect(spy.answer).toHaveBeenCalledTimes(1);
  });
  it('disables external calls when no chat endpoint is configured', async () => {
    vi.stubEnv('SPORTOS_AI_CHAT_ENDPOINT', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await service().answer(request, owner)).status).toBe('fallback');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects insecure endpoints, credentials in URLs and invalid timeout', () => {
    vi.stubEnv('SPORTOS_AI_CHAT_ENDPOINT', 'http://remote.example/chat'); expect(() => chatModelConfig()).toThrow();
    vi.stubEnv('SPORTOS_AI_CHAT_ENDPOINT', 'https://user:secret@remote.example/chat'); expect(() => chatModelConfig()).toThrow();
    vi.stubEnv('SPORTOS_AI_CHAT_ENDPOINT', 'https://remote.example/chat'); vi.stubEnv('SPORTOS_AI_TIMEOUT_MS', '999'); expect(() => chatModelConfig()).toThrow();
  });
  it('bounds response bytes before parsing', async () => {
    await expect(boundedJson(new Response('x'.repeat(1000)), 100)).rejects.toThrow('limit');
  });
  it('refuses writes without contacting the model or reading athlete data', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const result = await service().answer({ ...request, question: 'Please delete my activity data' }, owner);
    expect(result.status).toBe('refused'); expect(fetcher).not.toHaveBeenCalled(); expect(mocks.accounts).toEqual([]);
    expect(JSON.stringify(recorded)).not.toContain('Please delete');
  });
  it('returns safe fallback on provider failure without leaking provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('secret private error')));
    const result = await service().answer(request, owner);
    expect(result.status).toBe('fallback'); expect(JSON.stringify(result)).not.toContain('secret private');
    expect(mocks.accounts).toEqual([owner]); expect(JSON.stringify(recorded)).not.toContain(request.question);
  });
  it('rejects arbitrary tools and owner-bearing input before any read', async () => {
    for (const call of [{ name: 'delete_everything', arguments: '{}' }, { name: 'get_training_volume', arguments: JSON.stringify({ from: '2026-10-01', to: '2026-10-28', period: 'monthly', ownerId: owner }) }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: call }] } }] }))));
      expect((await service().answer(request, owner)).status).toBe('fallback');
    }
    expect(mocks.reads).not.toHaveBeenCalled();
  });
  it('accepts cited JSON from real MCP transport, binds each session owner and audits only metadata', async () => {
    const chat = service();
    for (const account of [owner, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']) {
      const fetcher = responses(); vi.stubGlobal('fetch', fetcher);
      const result = await chat.answer(request, account);
      expect(result.status).toBe('answered');
      expect(result.guidance).toEqual(answerDraft);
      expect(result.evidence[0]).toMatchObject({ key: 'evidence:1', tool: 'get_training_volume' });
      expect(JSON.stringify(fetcher.mock.calls)).not.toContain(account);
    }
    expect(mocks.accounts).toEqual([owner, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    expect(mocks.reads).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(recorded)).not.toContain('Synthetic retained evidence');
    expect(JSON.stringify(recorded)).not.toContain(request.question);
  });
  it('uses a bounded JSON-mode pass when tool mode returns unstructured prose', async () => {
    const fetcher = responses(answerDraft, 1, true); vi.stubGlobal('fetch', fetcher);
    const result = await service().answer(request, owner);
    expect(result.status).toBe('answered'); expect(result.guidance).toEqual(answerDraft);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const finalBody = JSON.parse(fetcher.mock.calls[2][1].body);
    expect(finalBody.response_format).toEqual({ type: 'json_object' }); expect(finalBody.tools).toBeUndefined();
  });
  it('allows a bounded correction after invalid or missing retained input', async () => {
    mocks.reads.mockImplementationOnce(() => { throw new ToolError('INVALID_INPUT', 'Synthetic date error'); });
    vi.stubGlobal('fetch', responses(answerDraft, 2));
    const result = await service().answer(request, owner);
    expect(result.status).toBe('answered');
    expect(result.evidence).toHaveLength(1);
    expect(mocks.reads).toHaveBeenCalledTimes(2);
  });
  it('reports only fixed stages and SQLSTATE when a hosted tool read fails', async () => {
    mocks.reads.mockImplementationOnce(() => { throw Object.assign(Error('private database record and credentials'), { code: '42501' }); });
    vi.stubGlobal('fetch', responses());
    expect((await service().answer(request, owner)).status).toBe('fallback');
    expect(Logger.prototype.warn).toHaveBeenCalledWith({ event: 'chat_fallback', stage: 'tool', tool: 'get_training_volume', code: 'UNAVAILABLE', sqlState: '42501' });
    expect(JSON.stringify(vi.mocked(Logger.prototype.warn).mock.calls)).not.toContain('private database');
  });
  it('supports clarification without reads but refuses unsupported factual observations', async () => {
    for (const [draft, expected] of [
      [{ observations: [], uncertainty: [], suggestions: [{ text: 'Which period should I compare?', citationKeys: [] }] }, 'answered'],
      [{ observations: [{ text: 'Unsupported claim', citationKeys: [] }], uncertainty: [], suggestions: [] }, 'fallback'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(draft) } }] }))));
      const result = await service().answer({ question: 'Compare?', history: [] }, owner);
      expect(result.status).toBe(expected); expect(result.evidence).toEqual([]);
    }
    expect(mocks.reads).not.toHaveBeenCalled();
  });
  it('rejects unknown citations and oversized generated sections', async () => {
    for (const draft of [{ ...answerDraft, observations: [{ text: 'Invented', citationKeys: ['foreign:1'] }] }, { ...answerDraft, observations: [{ text: 'x'.repeat(601), citationKeys: ['evidence:1'] }] }]) {
      vi.stubGlobal('fetch', responses(draft));
      const result = await service().answer(request, owner);
      expect(result.status).toBe('fallback');
      expect(result.generator).toBe('deterministic_fallback');
    }
  });
  it('blocks repeated concurrent questions and releases the account after completion', async () => {
    let reject!: (reason: Error) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_resolve, r) => { reject = r; })));
    const chat = service(); const pending = chat.answer(request, owner);
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    await expect(chat.answer(request, owner)).rejects.toThrow('busy');
    reject(Error('unavailable')); await pending;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('unavailable')));
    expect((await chat.answer(request, owner)).status).toBe('fallback');
  });
});
