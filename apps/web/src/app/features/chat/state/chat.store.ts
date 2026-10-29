import { Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChatApiService } from '../data-access/chat-api.service';
import type { ChatTurn } from '../model/chat.models';
@Injectable()
export class ChatStore implements OnDestroy {
  readonly turns = signal<ChatTurn[]>([]);
  readonly question = signal('');
  readonly pending = signal<string | null>(null);
  readonly error = signal('');
  private request?: Subscription;
  private version = 0;
  constructor(private readonly api: ChatApiService) {}
  send(text = this.question()) {
    if (this.pending()) return;
    const question = text.trim();
    if (!question || question.length > 2000) return;
    this.error.set(''); this.pending.set(question); this.question.set('');
    const version = ++this.version;
    const history = this.turns().slice(-3).flatMap(turn => [
      { role: 'user' as const, content: turn.question },
      { role: 'assistant' as const, content: Object.values(turn.answer.guidance).flat().map(i => i.text).join('\n').slice(0, 6000) || 'No supported observations.' },
    ]);
    this.request = this.api.answer({ question, history }).subscribe({
      next: answer => {
        if (version !== this.version) return;
        this.turns.update(turns => [...turns.slice(-19), { question, answer }]);
        this.pending.set(null);
      },
      error: (error: unknown) => {
        if (version !== this.version) return;
        this.pending.set(null); this.question.set(question);
        this.error.set(error instanceof Error ? error.message : 'Chat could not answer. Please try again.');
      },
    });
  }
  cancel() { this.version++; this.request?.unsubscribe(); this.question.set(this.pending() ?? this.question()); this.pending.set(null); }
  clear() { this.cancel(); this.turns.set([]); this.question.set(''); this.error.set(''); }
  ngOnDestroy() { this.clear(); }
}
