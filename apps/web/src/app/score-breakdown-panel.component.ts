import { Component, input, output, signal } from '@angular/core';
import { ScoreBreakdownActivitiesComponent } from './score-breakdown-activities.component';
import { ScoreBreakdownFactsComponent } from './score-breakdown-facts.component';
import { ScoreBreakdownGarminComponent } from './score-breakdown-garmin.component';
import { ScoreBreakdownLedgerComponent } from './score-breakdown-ledger.component';
import { ScoreBreakdownManualFactsComponent } from './score-breakdown-manual-facts.component';
import type {
  DailyScoreBreakdown,
  DailyEvidence,
  GarminObservation,
  ManualDailyFactsInput,
  ScoreBreakdownViewState,
} from './score-breakdown.models';
import { ScoreBreakdownProvenanceComponent } from './score-breakdown-provenance.component';
import { ScoreBreakdownSourceSummaryComponent } from './score-breakdown-source-summary.component';
import { ScoreBreakdownSummaryComponent } from './score-breakdown-summary.component';
import { formatScoreDate } from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-panel',
  standalone: true,
  imports: [
    ScoreBreakdownActivitiesComponent,
    ScoreBreakdownFactsComponent,
    ScoreBreakdownGarminComponent,
    ScoreBreakdownLedgerComponent,
    ScoreBreakdownManualFactsComponent,
    ScoreBreakdownProvenanceComponent,
    ScoreBreakdownSourceSummaryComponent,
    ScoreBreakdownSummaryComponent,
  ],
  template: `
    <section
      class="breakdown-panel"
      aria-live="polite"
      [attr.aria-busy]="state() === 'loading'"
      [attr.aria-labelledby]="headingId">
      <header class="panel-header">
        <div>
          <div class="eyebrow">Day overview</div>
          <h3 [id]="headingId">{{ date() ? 'Day · ' + formatScoreDate(date()) : 'Daily score breakdown' }}</h3>
          <p class="panel-subtitle">Your daily totals and training.</p>
        </div>
        @if (date()) {
          <button type="button" class="secondary-button" aria-label="Close score breakdown" (click)="closed.emit()">
            Close
          </button>
        }
      </header>

      <nav class="view-tabs" aria-label="Day views">
        @for (tab of tabs; track tab.id) {
          <button type="button" [attr.aria-pressed]="activeTab() === tab.id" (click)="activeTab.set(tab.id)">{{ tab.label }}</button>
        }
      </nav>
      @let current = breakdown();
      @if (state() === 'idle') {
        <div class="state-box">
          <span class="state-icon" aria-hidden="true">✦</span>
          <div>
            <strong>Select View details on a daily row.</strong>
            <span>The score, contributing activities, and source will appear here.</span>
          </div>
        </div>
      } @else if (state() === 'loading') {
        <div class="state-box" role="status">
          <span class="state-icon loading-icon" aria-hidden="true">…</span>
          <div>
            <strong>Loading score breakdown…</strong>
            <span>Reading the saved score for {{ formatScoreDate(date()) }}.</span>
          </div>
        </div>
      } @else if (state() === 'error') {
        <div class="state-box error-box" role="alert">
          <span class="state-icon" aria-hidden="true">!</span>
          <div>
            <strong>Score breakdown could not be loaded.</strong>
            <span>{{ errorMessage() || 'The API returned an unexpected error.' }}</span>
          </div>
          <button type="button" (click)="retry.emit()">Try again</button>
        </div>
      } @else if (!current) {
        <div class="state-box">
          <span class="state-icon" aria-hidden="true">—</span>
          <div>
            <strong>No score is available for this date.</strong>
            <span>There is no saved breakdown to display.</span>
          </div>
          <button type="button" (click)="requestManualEdit()">Enter facts manually</button>
        </div>
      } @else {
        @if (activeTab() === 'overview') {
          <sportos-score-breakdown-summary [breakdown]="current" [recalculating]="recalculating()" [recalculationError]="recalculationError()" (recalculate)="recalculate.emit()" />
          <sportos-score-breakdown-facts [breakdown]="current" (edit)="requestManualEdit()" />
          <sportos-score-breakdown-activities [breakdown]="current" [garminActivityIds]="garminActivityIds()" />
        } @else if (activeTab() === 'score') {
          <sportos-score-breakdown-summary [breakdown]="current" [detailed]="true" [recalculating]="recalculating()" [recalculationError]="recalculationError()" (recalculate)="recalculate.emit()" />
          <sportos-score-breakdown-facts [breakdown]="current" [detailed]="true" (edit)="requestManualEdit()" />
          <sportos-score-breakdown-ledger [breakdown]="current" />
        } @else {
          <sportos-score-breakdown-source-summary [breakdown]="current" />
          <sportos-score-breakdown-garmin [observations]="current.garminObservations" />
          <sportos-score-breakdown-provenance [breakdown]="current" />
        }
      }
      @if (!current && visibleGarminObservations().length > 0) {
        <sportos-score-breakdown-garmin [observations]="visibleGarminObservations()" />
        @if (activeTab() === 'sources') {
          <sportos-score-breakdown-provenance [sourceRecords]="evidence()?.sourceRecords ?? []" />
        }
      }
      <div [hidden]="activeTab() === 'score'"><ng-content /></div>

      <sportos-score-breakdown-manual-facts
        [active]="state() === 'loaded'"
        [date]="date()"
        [breakdown]="breakdown()"
        [saving]="savingManual()"
        [saveError]="manualSaveError()"
        [editRequestId]="manualEditRequestId() + localManualEditRequestId()"
        (save)="saveManualFacts.emit($event)" />
    </section>
  `,
  styles: [`
    .view-tabs { display: flex; gap: 6px; margin: 18px 0; border-bottom: 1px solid #dbe4f0; padding-bottom: 8px; }
    .view-tabs button { background: transparent; color: #667085; box-shadow: none; border: 1px solid transparent; border-radius: 8px; padding: 9px 16px; }
    .view-tabs button[aria-pressed='true'] { color: #243b73; background: #eaf0ff; font-weight: 750; }
    [hidden] { display: none !important; }
    .breakdown-panel {
      margin-top: 18px;
      border: 1px solid #dbe4f0;
      border-left: 4px solid #8b9de8;
      border-radius: 16px;
      padding: 20px;
      background: linear-gradient(145deg, #fbfcff 0%, #f4f7fc 100%);
      box-shadow: 0 8px 24px rgba(36, 55, 95, .07);
    }
    .panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .panel-header h3 { margin: 0; color: #172b4d; font-size: 22px; }
    .panel-subtitle { margin: 5px 0 0; color: #667085; font-size: 13px; }
    .eyebrow { margin-bottom: 5px; color: #5b6cae; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .secondary-button { background: white; color: #40558f; border: 1px solid #cbd6ed; box-shadow: none; }
    .state-box {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      padding: 18px;
      border: 1px dashed #c7d2e5;
      border-radius: 14px;
      background: white;
    }
    .state-box > div { display: grid; gap: 5px; }
    .state-box span { color: #667085; font-size: 12px; }
    .state-icon {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #dff4e5;
      color: #13795b;
      font-weight: 800;
    }
    .loading-icon { background: #e9edff; color: #5368ae; }
    .error-box { border-color: #efb9b9; background: #fff8f8; }
    .error-box .state-icon { background: #ffe2e2; color: #b54747; }
    .error-box button, .state-box > button { margin-left: auto; }
    @media (max-width: 680px) {
      .view-tabs { display: flex; gap: 6px; margin: 18px 0; border-bottom: 1px solid #dbe4f0; padding-bottom: 8px; }
    .view-tabs button { background: transparent; color: #667085; box-shadow: none; border: 1px solid transparent; border-radius: 8px; padding: 9px 16px; }
    .view-tabs button[aria-pressed='true'] { color: #243b73; background: #eaf0ff; font-weight: 750; }
    [hidden] { display: none !important; }
    .breakdown-panel { padding: 14px; }
      .panel-header h3 { font-size: 20px; }
    }
  `],
})
export class ScoreBreakdownPanelComponent {
  readonly activeTab = signal<'overview' | 'score' | 'sources'>('overview');
  readonly tabs = [{id: 'overview', label: 'Overview'}, {id: 'score', label: 'Score'}, {id: 'sources', label: 'Sources'}] as const;
  readonly garminActivityIds = input<string[]>([]);
  readonly state = input<ScoreBreakdownViewState>('idle');
  readonly date = input<string | null>(null);
  readonly breakdown = input<DailyScoreBreakdown | null>(null);
  readonly evidence = input<DailyEvidence | null>(null);
  readonly errorMessage = input<string | null>(null);
  readonly recalculating = input(false);
  readonly recalculationError = input<string | null>(null);
  readonly savingManual = input(false);
  readonly manualSaveError = input<string | null>(null);
  readonly manualEditRequestId = input(0);

  readonly retry = output<void>();
  readonly recalculate = output<void>();
  readonly saveManualFacts = output<ManualDailyFactsInput>();
  readonly closed = output<void>();

  readonly localManualEditRequestId = signal(0);
  readonly headingId = 'daily-score-breakdown-heading';
  readonly formatScoreDate = formatScoreDate;

  visibleGarminObservations(): GarminObservation[] {
    return this.breakdown()?.garminObservations ?? this.evidence()?.garminObservations ?? [];
  }

  requestManualEdit(): void {
    this.localManualEditRequestId.update((value) => value + 1);
  }
}
