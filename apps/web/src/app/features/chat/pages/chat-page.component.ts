import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatStore } from '../state/chat.store';
@Component({
  selector: 'sportos-chat-page', standalone: true, imports: [RouterLink], providers: [ChatStore],
  template: `
    <section class="chat-page" aria-labelledby="chat-title">
      <header><div><p class="eyebrow">YOUR TRAINING, IN CONTEXT</p><h2 id="chat-title">Chat with SportOS</h2></div>
        <button class="secondary" (click)="store.clear()" [disabled]="!store.turns().length && !store.pending()">New chat</button></header>
      <p class="intro">Explore your training history, recent volume and personal bests. Answers use retained SportOS evidence, with sources you can inspect.</p>
      <p class="help">Generated guidance can be wrong. Chat reads data only. <a routerLink="/analysis">Daily score analysis</a></p>
      @if (!store.turns().length && !store.pending()) {
        <div class="starters" aria-label="Suggested questions">
          @for (prompt of prompts; track prompt) { <button class="secondary" (click)="store.send(prompt)">{{ prompt }}</button> }
        </div>
      }
      <div class="conversation" aria-live="polite" aria-relevant="additions">
        @for (turn of store.turns(); track turn) {
          <article class="turn"><div class="question"><span class="eyebrow">YOU</span><p>{{ turn.question }}</p></div>
            <div class="answer"><p class="eyebrow">SPORTOS · {{ turn.answer.model || 'SAFE FALLBACK' }}</p>
              @if (turn.answer.status === 'fallback') { <p class="notice" role="status">The model could not complete this answer. Try a narrower question or try again.</p> }
              @for (item of turn.answer.guidance.observations; track $index) { <p>{{ item.text }} <small>{{ item.citationKeys.join(', ') }}</small></p> }
              @if (turn.answer.guidance.uncertainty.length) { <h3>What to keep in mind</h3>
                @for (item of turn.answer.guidance.uncertainty; track $index) { <p class="help">{{ item.text }}</p> }
              }
              @for (item of turn.answer.guidance.suggestions; track $index) { <p>{{ item.text }}</p> }
              @if (turn.answer.evidence.length) { <details><summary>Official evidence · {{ turn.answer.evidence.length }} reads</summary>
                @for (source of turn.answer.evidence; track source.key) {
                  <details class="source"><summary>{{ source.key }} · {{ toolLabel(source.tool) }}</summary><pre>{{ format(source.input) }}</pre><pre>{{ format(source.result) }}</pre></details>
                }
                <small>Audit reference: {{ turn.answer.auditId }}</small>
              </details> }
            </div>
          </article>
        }
        @if (store.pending(); as question) { <div class="question"><span class="eyebrow">YOU</span><p>{{ question }}</p></div><p role="status">Reading your training evidence…</p> }
      </div>
      @if (store.error()) { <p role="alert" class="notice">{{ store.error() }}</p> }
      <form (submit)="store.send(); $event.preventDefault()">
        <label for="chat-question">Ask about your training</label>
        <textarea id="chat-question" rows="3" maxlength="2000" required [disabled]="!!store.pending()" [value]="store.question()" (input)="store.question.set($any($event.target).value)" placeholder="How has my running volume changed over the last three months?"></textarea>
        <div class="actions"><small>Conversation stays in this page’s memory. New chat clears it.</small>
          @if (store.pending()) { <button type="button" class="secondary" (click)="store.cancel()">Cancel</button> }
          @else { <button type="submit" [disabled]="!store.question().trim()">Send question</button> }
        </div>
      </form>
    </section>
  `,
  styles: [`
    :host { display:block; } .chat-page { max-width: 900px; margin: 0 auto; padding: 1rem; }
    header,.actions { display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
    h2 { font-size:clamp(1.7rem,4vw,2.4rem); margin:.25rem 0; } h3 { font-size:.95rem; margin-top:1.5rem; }
    .eyebrow { font-size:.7rem; letter-spacing:.1em; font-weight:700; opacity:.65; } .intro { line-height:1.6; max-width:70ch; }
    .help,small { opacity:.75; line-height:1.5; } .starters { display:flex; gap:.75rem; flex-wrap:wrap; margin:2rem 0; }
    .conversation { margin:2rem 0; } .turn { margin-bottom:2rem; } .question { border-left:3px solid var(--accent, #408c82); padding:.7rem 1rem; background:var(--surface-alt,rgba(128,128,128,.08)); border-radius:8px; }
    .question p { margin:.3rem 0; white-space:pre-wrap; } .answer { padding:1rem 0; line-height:1.65; } .answer p { white-space:pre-wrap; } .answer small { font-size:.7rem; }
    details { border:1px solid var(--border-color, #8886); border-radius:8px; padding:.8rem; margin-top:1rem; } summary { cursor:pointer; font-size:.85rem; } pre { overflow:auto; max-height:24rem; font-size:.75rem; white-space:pre-wrap; overflow-wrap:anywhere; }
    form { padding:1rem 0; border-top:1px solid var(--border-color,#8886); } label { display:block; font-weight:600; margin-bottom:.5rem; } textarea { box-sizing:border-box; width:100%; padding:1rem; border-radius:12px; resize:vertical; font:inherit; } .actions { margin-top:.75rem; } .notice { border-left:3px solid #b88a31; padding:.75rem; }
  `],
})
export class ChatPageComponent {
  readonly prompts = ['How has my training changed in the last 90 days?', 'What are my best 5 km running efforts?', 'Compare my swimming and cycling volume this month.'];
  constructor(readonly store: ChatStore) {}
  format(value: unknown) { return JSON.stringify(value, null, 2); }
  toolLabel(tool: string) { return ({ get_athlete_snapshot: 'Athlete snapshot', get_training_volume: 'Training volume', get_personal_bests: 'Personal bests', search_activities: 'Activity search', get_activity_details: 'Activity details' } as Record<string, string>)[tool] ?? tool; }
}
