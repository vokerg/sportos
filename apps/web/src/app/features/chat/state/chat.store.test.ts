import '@angular/compiler';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ChatStore } from './chat.store';
import type { ChatApiService } from '../data-access/chat-api.service';
import type { ChatAnswer } from '../model/chat.models';
const answer: ChatAnswer = { status: 'answered', guidance: { observations: [{ text: 'Synthetic observation', citationKeys: ['evidence:1'] }], uncertainty: [], suggestions: [] }, generator: 'external_model', model: 'synthetic-model', evidence: [], auditId: 'synthetic-audit' };
describe('ChatStore', () => {
  it('retains bounded conversational context and prevents repeated sends', () => {
    const response = new Subject<ChatAnswer>();
    const api = { answer: vi.fn().mockReturnValue(response) };
    const store = new ChatStore(api as unknown as ChatApiService);
    store.send('First question'); store.send('Repeated');
    expect(api.answer).toHaveBeenCalledTimes(1);
    response.next(answer);
    api.answer.mockReturnValue(of(answer));
    store.send('Follow up');
    expect(api.answer).toHaveBeenLastCalledWith({ question: 'Follow up', history: [{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'Synthetic observation' }] });
    for (let i = 0; i < 25; i++) store.send('Question ' + i);
    expect(store.turns()).toHaveLength(20);
    expect(api.answer.mock.lastCall?.[0].history).toHaveLength(6);
  });
  it('cancels requests and drops stale results on new chat or teardown', () => {
    const response = new Subject<ChatAnswer>();
    const store = new ChatStore({ answer: () => response } as unknown as ChatApiService);
    store.send('Question'); store.clear(); response.next(answer);
    expect(store.turns()).toEqual([]); expect(store.pending()).toBeNull();
    store.send('Another'); store.ngOnDestroy(); response.next(answer);
    expect(store.turns()).toEqual([]); expect(store.question()).toBe('');
  });
  it('restores a failed question for retry and rejects empty or oversized input', () => {
    const api = { answer: vi.fn().mockReturnValue(throwError(() => Error('Try again.'))) };
    const store = new ChatStore(api as unknown as ChatApiService);
    store.send(''); store.send('x'.repeat(2001)); expect(api.answer).not.toHaveBeenCalled();
    store.send('Please compare'); expect(store.question()).toBe('Please compare'); expect(store.error()).toBe('Try again.');
  });
});
