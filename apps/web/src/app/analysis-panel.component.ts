import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  AnalysisApiService,
  type AnalysisAnswer,
  type AnalysisAnswerRequest,
} from './analysis-api.service';

type AnalysisState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'sportos-analysis-panel',
  standalone: true,
  template: `
    <section class="card" aria-labelledby="analysis-title">
      <h2 id="analysis-title">Read-only analysis</h2>
      <p class="boundary"><strong>Generated guidance is not an official SportOS record.</strong> This surface cannot edit activities, activate rules, persist scores, or run jobs. All official calculations remain deterministic.</p>

      <form class="analysis-form" (submit)="analyze(); $event.preventDefault()" aria-label="Read-only analysis request">
        <label>Evidence
          <select [value]="tool()" (change)="tool.set($any($event.target).value)">
            <option value="daily_summary">Daily range</option>
            <option value="daily_score_breakdown">Score breakdown</option>
          </select>
        </label>
        @if (tool() === 'daily_summary') {
          <label>From <input type="date" required [value]="from()" (input)="from.set($any($event.target).value)" /></label>
          <label>To <input type="date" required [value]="to()" (input)="to.set($any($event.target).value)" /></label>
        } @else {
          <label>Date <input type="date" required [value]="date()" (input)="date.set($any($event.target).value)" /></label>
        }
        <label class="question">Question
          <textarea rows="3" maxlength="500" required [value]="question()" (input)="question.set($any($event.target).value)" aria-describedby="analysis-question-help"></textarea>
        </label>
        <p id="analysis-question-help" class="help">Questions may ask for observations or explanations. Requests to change official data are refused.</p>
        <button type="submit" [disabled]="state() === 'loading'">Analyze cited records</button>
      </form>

      @if (state() === 'loading') {
        <p role="status" aria-live="polite">Reading official records and preparing guidance…</p>
      } @else if (state() === 'error') {
        <p class="state-message error" role="alert">{{ errorMessage() }}</p>
      } @else if (state() === 'ready') {
        @if (result(); as answer) {
          <section class="generated" aria-labelledby="generated-guidance-title">
            <h3 id="generated-guidance-title">Generated guidance</h3>
            <p class="help">Generator: {{ generatorLabel(answer) }}. Guidance may be incomplete or wrong; verify it against the cited official evidence below.</p>
            @if (answer.status === 'refused') {
              <p class="state-message warning">The request was refused because it asked this read-only surface to change authoritative data.</p>
            }
            <div class="answer-grid">
              <div>
                <h4>Observations</h4>
                @if (answer.generatedGuidance.observations.length === 0) { <p>No supported observations.</p> }
                <ul>@for (item of answer.generatedGuidance.observations; track item.text) {
                  <li>{{ item.text }} <small>{{ citationSummary(item.citationKeys) }}</small></li>
                }</ul>
              </div>
              <div>
                <h4>Uncertainty</h4>
                @if (answer.generatedGuidance.uncertainty.length === 0) { <p>No additional uncertainty was generated.</p> }
                <ul>@for (item of answer.generatedGuidance.uncertainty; track item.text) {
                  <li>{{ item.text }} <small>{{ citationSummary(item.citationKeys) }}</small></li>
                }</ul>
              </div>
              <div>
                <h4>Suggestions</h4>
                <ul>@for (item of answer.generatedGuidance.suggestions; track item.text) {
                  <li>{{ item.text }} <small>{{ citationSummary(item.citationKeys) }}</small></li>
                }</ul>
              </div>
            </div>
          </section>

          <section class="official" aria-labelledby="official-record-title">
            <h3 id="official-record-title">Official SportOS evidence</h3>
            @if (answer.officialRecord; as record) {
              <p><strong>{{ record.tool }}</strong> · data quality: <strong>{{ record.dataQuality.status }}</strong></p>
              @if (record.dataQuality.flags.length > 0) {
                <p class="help">Flags: {{ record.dataQuality.flags.join(', ') }}</p>
              }
              <details class="facts">
                <summary>Official deterministic facts</summary>
                <pre>{{ formatFacts(record.facts) }}</pre>
              </details>
              <h4>Evidence identifiers</h4>
              <ul class="citations">
                @for (citation of record.citations; track citation.key) {
                  <li><code>{{ citation.key }}</code> — {{ citation.label }}</li>
                }
              </ul>
            } @else {
              <p>No official record was read for this refused request.</p>
            }
            <p class="audit">Audit reference: <code>{{ answer.auditId }}</code></p>
          </section>
        }
      }
    </section>
  `,
  styles: [`
    .boundary { border-left: 4px solid #475467; padding: 10px 12px; background: #f8fafc; }
    .analysis-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; }
    .question, .help, .analysis-form button { grid-column: 1 / -1; }
    textarea, select, input { width: 100%; }
    .generated, .official { margin-top: 18px; padding-top: 16px; border-top: 1px solid #d0d5dd; }
    .answer-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .help, small, .audit { color: #667085; font-size: 13px; }
    small { display: block; margin-top: 3px; }
    .facts { margin: 12px 0; }
    .facts pre { max-height: 280px; overflow: auto; padding: 12px; background: #f8fafc; border: 1px solid #d0d5dd; white-space: pre-wrap; overflow-wrap: anywhere; }
    .citations { max-height: 240px; overflow: auto; }
    .warning { background: #fffaeb; }
    @media (max-width: 760px) { .analysis-form, .answer-grid { grid-template-columns: 1fr; } }
  `],
})
export class AnalysisPanelComponent implements OnDestroy {
  readonly tool = signal<'daily_summary' | 'daily_score_breakdown'>('daily_summary');
  readonly from = signal(daysAgo(30));
  readonly to = signal(today());
  readonly date = signal(today());
  readonly question = signal('What stands out in these official records?');
  readonly state = signal<AnalysisState>('idle');
  readonly result = signal<AnalysisAnswer | null>(null);
  readonly errorMessage = signal<string | null>(null);
  private subscription?: Subscription;

  constructor(private readonly api: AnalysisApiService) {}

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  analyze(): void {
    const request = this.buildRequest();
    if (!request) return;
    this.subscription?.unsubscribe();
    this.state.set('loading');
    this.errorMessage.set(null);
    this.subscription = this.api.answer(request).subscribe({
      next: (answer) => {
        this.result.set(answer);
        this.state.set('ready');
      },
      error: (error: unknown) => {
        this.errorMessage.set(this.describeError(error));
        this.state.set('error');
      },
    });
  }

  generatorLabel(answer: AnalysisAnswer): string {
    return answer.generatedGuidance.generator === 'external_model'
      ? `${answer.generatedGuidance.provider ?? 'external model'} / ${answer.generatedGuidance.model ?? 'configured model'}`
      : 'deterministic safe fallback';
  }

  citationSummary(keys: string[]): string {
    if (keys.length === 0) return '';
    return `Evidence: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ` (+${keys.length - 3} more)` : ''}`;
  }

  formatFacts(facts: unknown): string {
    return JSON.stringify(facts, null, 2);
  }

  private buildRequest(): AnalysisAnswerRequest | null {
    const question = this.question().trim();
    if (!question) return this.fail('Enter a question.');
    if (this.tool() === 'daily_summary') {
      if (!this.from() || !this.to()) return this.fail('Choose both range dates.');
      if (this.from() > this.to()) return this.fail('From date must be on or before the to date.');
      return { question, tool: 'daily_summary', input: { from: this.from(), to: this.to(), limit: 366 } };
    }
    if (!this.date()) return this.fail('Choose a score date.');
    return { question, tool: 'daily_score_breakdown', input: { date: this.date() } };
  }

  private fail(message: string): null {
    this.errorMessage.set(message);
    this.state.set('error');
    return null;
  }

  private describeError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The analysis request failed unexpectedly.';
    const body = error.error && typeof error.error === 'object' ? error.error as { message?: string } : null;
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The analysis API returned HTTP ${error.status}.`;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
