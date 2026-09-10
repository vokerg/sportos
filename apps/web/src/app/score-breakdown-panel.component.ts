import { Component, input, output, signal } from '@angular/core';
import type {
  DailyScoreBreakdown,
  JsonValue,
  ManualDailyFactsInput,
  ScoreBreakdownActivity,
  ScoreBreakdownLedgerEntry,
  SourceRecordReference,
} from './score-breakdown.models';
import { formatDate, formatDateTime } from './date-time';

export type ScoreBreakdownViewState = 'idle' | 'loading' | 'loaded' | 'error';
export type DeltaKind = 'positive' | 'negative' | 'zero' | 'unavailable';

interface ImportedLedgerInput {
  key: string;
  label: string;
  reference: string | null;
  value: number;
}

interface ImportedLedgerDetails {
  formula: string | null;
  inputs: ImportedLedgerInput[];
  additiveFormula: boolean;
  showEquation: boolean;
  inputTotal: number | null;
  matchesTotal: boolean;
}

@Component({
  selector: 'sportos-score-breakdown-panel',
  standalone: true,
  template: `
    <section
      class="breakdown-panel"
      aria-live="polite"
      [attr.aria-busy]="state() === 'loading'"
      [attr.aria-labelledby]="headingId">
      <header class="panel-header">
        <div>
          <div class="eyebrow">Score explanation</div>
          <h3 [id]="headingId">{{ date() ? 'Daily score · ' + formatDate(date()) : 'Daily score breakdown' }}</h3>
          <p class="panel-subtitle">Imported workbook ledgers, calculated activity totals, and manual fact sets are kept as explicit authority states.</p>
        </div>
        @if (date()) {
          <button type="button" class="secondary-button" aria-label="Close score breakdown" (click)="closed.emit()">
            Close
          </button>
        }
      </header>

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
            <span>Reading the saved score for {{ formatDate(date()) }}.</span>
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
          <button type="button" (click)="startManualEdit(null)">Enter facts manually</button>
        </div>
      } @else {
        <div class="score-overview" aria-label="Score summary">
          <div class="total-card">
            <span class="metric-label">Total score</span>
            <strong>{{ formatNumber(current.score.appTotal) }}</strong>
            <span class="status-badge" [attr.data-status]="current.scoreStatus">{{ scoreStatusLabel(current.scoreStatus) }}</span>
            <span class="total-note">{{ scoreAuthorityNote(current.scoreStatus) }}</span>
            <button type="button" class="secondary-button recalculation-action" (click)="recalculate.emit()" [disabled]="recalculating()">
              {{ recalculating() ? 'Recalculating…' : 'Recalculate from activities' }}
            </button>
            @if (recalculationError()) {
              <span class="recalculation-error" role="alert">{{ recalculationError() }}</span>
            }
          </div>
          <div class="metric-grid">
            <div class="metric-card">
              <span class="metric-label">{{ current.scoreStatus === 'imported' ? 'Imported ledger total' : 'Base' }}</span>
              <strong>{{ formatNumber(current.score.baseTotal) }}</strong>
            </div>
            <div class="metric-card">
              <span class="metric-label">{{ current.scoreStatus === 'imported' ? 'Calculated bonus' : 'Bonus' }}</span>
              <strong class="positive-points">{{ current.scoreStatus === 'imported' ? 'Not applied' : formatSigned(current.score.bonusTotal) }}</strong>
            </div>
            <div class="metric-card delta-card" [attr.data-delta]="deltaKind(current.score.delta)">
              <span class="metric-label">Compared with Excel</span>
              <strong>{{ deltaValue(current.score.delta) }}</strong>
              <small>{{ deltaDescription(current.score.delta) }}</small>
            </div>
          </div>
        </div>

        <div class="consistency-row" [class.consistency-warning]="!ledgerMatchesAppTotal(current)">
          <span class="consistency-icon" aria-hidden="true">{{ ledgerMatchesAppTotal(current) ? '✓' : '!' }}</span>
          <div>
            <strong>{{ ledgerMatchesAppTotal(current) ? 'Everything adds up' : 'Review the score details' }}</strong>
            <span>Ledger total: {{ formatNumber(ledgerSum(current)) }} · {{ ledgerMatchesAppTotal(current) ? 'matches' : 'does not match' }} the app total.</span>
          </div>
        </div>

        <section class="facts-section" aria-labelledby="daily-facts-title">
          <div class="section-heading">
            <div>
              <span class="section-label">Canonical facts</span>
              <h4 id="daily-facts-title">Everything SportOS used for this day</h4>
            </div>
            <button type="button" class="secondary-button" (click)="startManualEdit(current)">Edit facts</button>
          </div>
          <div class="facts-grid">
            <div><span>Steps</span><strong>{{ formatNumber(current.facts.steps) }}</strong></div>
            <div><span>Run</span><strong>{{ formatDistance(current.facts.runM) }}</strong></div>
            <div><span>Run · treadmill</span><strong>{{ formatDistance(current.facts.runIndoorM) }}</strong></div>
            <div><span>Run · outdoor</span><strong>{{ formatDistance(current.facts.runOutdoorM) }}</strong></div>
            <div><span>Bike</span><strong>{{ formatDistance(current.facts.bikeM) }}</strong></div>
            <div><span>Bike · indoor</span><strong>{{ formatDistance(current.facts.bikeIndoorM) }}</strong></div>
            <div><span>Bike · outdoor</span><strong>{{ formatDistance(current.facts.bikeOutdoorM) }}</strong></div>
            <div><span>Swim</span><strong>{{ formatDistance(current.facts.swimM, 0) }}</strong></div>
            <div><span>Workout points</span><strong>{{ formatNumber(current.facts.workoutPoints) }}</strong></div>
            <div><span>Power points</span><strong>{{ formatNumber(current.facts.powerPoints) }}</strong></div>
          </div>
        </section>

        <div class="source-card">
          <span class="source-icon" aria-hidden="true">↗</span>
          <div class="source-copy">
            <span class="section-label">Source</span>
            <strong>{{ sourceSummary(current.sourceRecord) }}</strong>
          </div>
          @if (current.sourceRecord) {
            <details class="quiet-details">
              <summary>View details</summary>
              <dl>
                <dt>Batch</dt><dd>{{ current.sourceRecord.batch.id }}</dd>
                <dt>Workbook</dt><dd>{{ current.sourceRecord.batch.filename || current.sourceRecord.batch.source }}</dd>
                <dt>File hash</dt><dd class="hash">{{ current.sourceRecord.batch.originalSha256 || 'Unavailable' }}</dd>
                <dt>Row hash</dt><dd class="hash">{{ current.sourceRecord.rowHash }}</dd>
              </dl>
            </details>
          }
        </div>

        <section class="data-section" aria-labelledby="day-activities-title">
          <div class="section-heading">
            <div>
              <span class="section-label">All canonical activities</span>
              <h4 id="day-activities-title">Activities recorded for {{ formatDate(date()) }}</h4>
              <p class="section-help">Imported rows use the saved workbook ledger. Recalculated rows use the canonical activities shown here, including Strava records.</p>
            </div>
            <strong class="count-badge">{{ current.activities.length }}</strong>
          </div>
          @if (current.activities.length === 0) {
            <div class="empty-inline">No canonical activities were recorded for this date.</div>
          } @else {
            <div class="table-scroll">
              <table class="activity-table">
                <thead>
                  <tr><th>Source</th><th>Activity</th><th>Distance</th><th>Elapsed</th><th>Moving</th><th>Pace / speed</th><th>Score link</th><th>Provenance</th></tr>
                </thead>
                <tbody>
                  @for (activity of current.activities; track activity.id) {
                    <tr>
                      <td><span class="source-badge" [attr.data-source]="activity.source">{{ sourceName(activity.source) }}</span></td>
                      <td><strong>{{ activityName(activity) }}</strong><small>{{ formatTimestamp(activity.startTime, 'No start time') }}</small></td>
                      <td>{{ activity.distanceM === null ? '—' : formatDistance(activity.distanceM) }}</td>
                      <td>{{ activity.durationS === null ? '—' : formatDurationValue(activity.durationS) }}</td>
                      <td>{{ activity.movingTimeS === null ? '—' : formatDurationValue(activity.movingTimeS) }}</td>
                      <td>{{ activity.avgPaceSPerKm === null ? (activity.avgSpeedMps === null ? '—' : formatSpeed(activity.avgSpeedMps)) : formatPace(activity.avgPaceSPerKm) }}</td>
                      <td><span class="score-link" [class.context-only]="activityScoreLabel(activity, current) === 'Context only'" [class.daily-fact]="activityScoreLabel(activity, current) === 'Daily fact'">{{ activityScoreLabel(activity, current) }}</span></td>
                      <td>{{ sourceSummary(activity.sourceRecord) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="data-section" aria-labelledby="day-source-title">
          <div class="section-heading">
            <div>
              <span class="section-label">Raw provenance</span>
              <h4 id="day-source-title">Every source record for this day</h4>
              <p class="section-help">This is the unabridged source payload behind the daily row and the imported provider activities.</p>
            </div>
            <strong class="count-badge">{{ current.sourceRecords.length }}</strong>
          </div>
          @if (current.sourceRecords.length === 0) {
            <div class="empty-inline">No source records are linked to this date.</div>
          } @else {
            <div class="source-record-list">
              @for (record of current.sourceRecords; track record.id) {
                <details class="source-record">
                  <summary>
                    <span class="source-badge" [attr.data-source]="record.batch.source">{{ sourceName(record.batch.source) }}</span>
                    <strong>{{ sourceRecordTitle(record) }}</strong>
                    <span class="source-record-meta">{{ record.status }} · {{ record.normalizedEntityType || 'raw only' }}</span>
                  </summary>
                  <div class="source-record-body">
                    <dl class="source-meta">
                      <dt>Batch</dt><dd>{{ record.batch.filename || record.batch.source }} · {{ record.batch.status }}</dd>
                      <dt>Location</dt><dd>{{ record.sheetName || 'Provider payload' }}{{ record.rowIndex === null ? '' : ' · row ' + record.rowIndex }}</dd>
                      <dt>Record key</dt><dd class="mono">{{ record.normalizedEntityId || record.id }}</dd>
                    </dl>
                    @if (hasWorkbookCells(record.rawJson)) {
                      <div class="raw-table-wrap">
                        <table class="raw-cell-table">
                          <thead><tr><th>Column</th><th>Raw value</th></tr></thead>
                          <tbody>
                            @for (cell of workbookCells(record.rawJson); track $index) {
                              <tr><th>{{ workbookHeader(record.rawJson, $index) }}</th><td>{{ rawValueLabel(cell) }}</td></tr>
                            }
                          </tbody>
                        </table>
                      </div>
                    } @else {
                      <pre class="raw-json">{{ jsonLabel(record.rawJson) }}</pre>
                    }
                  </div>
                </details>
              }
            </div>
          }
        </section>

        <div class="ledger-heading">
          <div>
            <span class="section-label">Score details</span>
            <h4>How the score was built</h4>
            <p>{{ current.ledger.length }} contribution{{ current.ledger.length === 1 ? '' : 's' }} to this day's total</p>
          </div>
          <span class="recomputed">Saved {{ formatTimestamp(current.recomputedAt) }}</span>
        </div>

        @if (current.ledger.length === 0) {
          <div class="state-box">
            <strong>No contributions were saved.</strong>
            <span>The app total for this date is {{ formatNumber(current.score.appTotal) }}.</span>
          </div>
        } @else {
          <div class="ledger-list" aria-label="Score contributions">
            @for (entry of current.ledger; track entry.id) {
              <article class="ledger-entry">
                <div class="entry-top">
                  <div class="rule-copy">
                    <span class="rule-dot" aria-hidden="true"></span>
                    <div>
                      <strong>{{ entry.rule?.name || (current.scoreStatus === 'imported' ? 'Imported workbook ledger' : 'Rule unavailable') }}</strong>
                      <code>{{ entry.rule?.code || (current.scoreStatus === 'imported' ? 'imported.all' : 'unlinked') }}</code>
                    </div>
                  </div>
                  <span class="points-pill" [class.positive-points]="entry.points > 0" [class.negative-points]="entry.points < 0">
                    {{ formatSigned(entry.points) }}
                  </span>
                </div>
                <p class="entry-reason">{{ entry.reason }}</p>
                <div class="entry-context">
                  <span><small>Activity</small>{{ activityLabel(entry.activity) }}</span>
                  <span><small>Source</small>{{ sourceSummary(entry.activity?.sourceRecord || null) }}</span>
                </div>
                <details class="entry-details">
                  <summary>Show calculation details</summary>
                  @let imported = importedLedgerDetails(entry, current);
                  <div class="detail-grid">
                    @if (imported) {
                      <div class="imported-calculation">
                        <span class="detail-label">Workbook calculation</span>
                        @if (imported.formula) {
                          <div class="formula-line">
                            <span>Formula for All</span>
                            <code>{{ formatWorkbookFormula(imported.formula) }}</code>
                          </div>
                        } @else {
                          <p class="calculation-note">The workbook supplied <code>All</code>, but its original formula was not retained in this import.</p>
                        }
                        @if (imported.inputs.length > 0) {
                          @if (imported.showEquation) {
                            <div
                              class="calculation-equation"
                              [class.source-evidence-equation]="!imported.formula"
                              [attr.aria-label]="importedEquationLabel(imported, entry.points)">
                              @for (input of imported.inputs; track input.key) {
                                <span class="equation-term">
                                  <span>{{ input.label }}{{ input.reference ? ' · ' + input.reference : '' }}</span>
                                  <strong>{{ formatNumber(input.value) }}</strong>
                                </span>
                                @if (!$last) {
                                  <span class="equation-operator" aria-hidden="true">+</span>
                                }
                              }
                              <span class="equation-operator" aria-hidden="true">=</span>
                              <strong class="equation-total">{{ formatNumber(imported.inputTotal ?? entry.points) }}</strong>
                              @if (!imported.matchesTotal) {
                                <span class="equation-arrow" aria-hidden="true">→ All</span>
                                <strong class="equation-total">{{ formatNumber(entry.points) }}</strong>
                              }
                            </div>
                          } @else {
                            <div class="formula-input-grid">
                              @for (input of imported.inputs; track input.key) {
                                <span>
                                  <small>{{ input.label }}{{ input.reference ? ' · ' + input.reference : '' }}</small>
                                  <strong>{{ formatNumber(input.value) }}</strong>
                                </span>
                              }
                            </div>
                          }
                          @if (!imported.formula) {
                            <p class="calculation-note">{{ imported.matchesTotal ? 'These cached workbook values are an evidence check, not a reconstructed formula.' : 'The available cached workbook fields do not fully explain All; the original formula was not retained.' }}</p>
                          } @else if (!imported.matchesTotal) {
                            <p class="calculation-note">The visible formula inputs total {{ formatNumber(imported.inputTotal ?? 0) }}; the cached workbook <code>All</code> value is {{ formatNumber(entry.points) }}.</p>
                          }
                        } @else if (imported.formula) {
                          <p class="calculation-note">The formula was retained, but it has no numeric row inputs that SportOS can display.</p>
                        }
                        <p class="calculation-note">This imported <code>All</code> value is authoritative; SportOS does not recalculate or replace the workbook formula during import.</p>
                      </div>
                    } @else {
                      <div>
                        <span class="detail-label">Inputs</span>
                        <p>{{ calculationLabel(entry.calculation) }}</p>
                      </div>
                    }
                    @if (entry.rule) {
                      <div>
                        <span class="detail-label">Rule active</span>
                        <p>{{ formatDate(entry.rule.validFrom) }}{{ entry.rule.validTo ? ' – ' + formatDate(entry.rule.validTo) : ' onward' }}</p>
                      </div>
                    }
                    @if (entry.activity?.notes) {
                      <div>
                        <span class="detail-label">Notes</span>
                        <p>{{ entry.activity?.notes }}</p>
                      </div>
                    }
                    @if (entry.activity?.sourceRecord) {
                      <div>
                        <span class="detail-label">Activity provenance</span>
                        <p>Batch {{ entry.activity?.sourceRecord?.batch?.id }} · Row {{ entry.activity?.sourceRecord?.rowHash }}</p>
                      </div>
                    }
                  </div>
                </details>
              </article>
            }
          </div>
        }
      }

      @if (editingManual() || (state() === 'loaded' && date() && !breakdown())) {
        <form class="manual-facts-form" (submit)="submitManualFacts(); $event.preventDefault()">
          <div class="section-heading">
            <div>
              <span class="section-label">Manual canonical entry</span>
              <h4>{{ breakdown() ? 'Replace the current daily facts' : 'Create daily facts for ' + formatDate(date()) }}</h4>
              <p class="section-help">Totals drive scoring. Indoor/outdoor splits are retained as manual activities; any remainder stays unspecified.</p>
            </div>
          </div>
          <div class="manual-facts-grid">
            <label>Steps <input type="number" min="0" step="1" [value]="manualSteps()" (input)="manualSteps.set($any($event.target).valueAsNumber)" /></label>
            <label>Run total (km) <input type="number" min="0" step="0.01" [value]="manualRunKm()" (input)="manualRunKm.set($any($event.target).valueAsNumber)" /></label>
            <label>Run treadmill (km) <input type="number" min="0" step="0.01" [value]="manualRunIndoorKm()" (input)="manualRunIndoorKm.set($any($event.target).valueAsNumber)" /></label>
            <label>Run outdoor (km) <input type="number" min="0" step="0.01" [value]="manualRunOutdoorKm()" (input)="manualRunOutdoorKm.set($any($event.target).valueAsNumber)" /></label>
            <label>Bike total (km) <input type="number" min="0" step="0.01" [value]="manualBikeKm()" (input)="manualBikeKm.set($any($event.target).valueAsNumber)" /></label>
            <label>Bike indoor (km) <input type="number" min="0" step="0.01" [value]="manualBikeIndoorKm()" (input)="manualBikeIndoorKm.set($any($event.target).valueAsNumber)" /></label>
            <label>Bike outdoor (km) <input type="number" min="0" step="0.01" [value]="manualBikeOutdoorKm()" (input)="manualBikeOutdoorKm.set($any($event.target).valueAsNumber)" /></label>
            <label>Swim (m) <input type="number" min="0" step="1" [value]="manualSwimM()" (input)="manualSwimM.set($any($event.target).valueAsNumber)" /></label>
            <label>Workout points <input type="number" min="0" step="1" [value]="manualWorkoutPoints()" (input)="manualWorkoutPoints.set($any($event.target).valueAsNumber)" /></label>
            <label>Power points <input type="number" min="0" step="1" [value]="manualPowerPoints()" (input)="manualPowerPoints.set($any($event.target).valueAsNumber)" /></label>
          </div>
          @if (manualValidationError()) { <p class="recalculation-error" role="alert">{{ manualValidationError() }}</p> }
          @if (manualSaveError()) { <p class="recalculation-error" role="alert">{{ manualSaveError() }}</p> }
          <div class="manual-form-actions">
            <button type="submit" [disabled]="savingManual()">{{ savingManual() ? 'Savingâ€¦' : 'Save manual facts' }}</button>
            <button type="button" class="secondary-button" [disabled]="savingManual()" (click)="editingManual.set(false)">Cancel</button>
          </div>
        </form>
      }
    </section>
  `,
  styles: [`
    .breakdown-panel {
      margin-top: 18px;
      border: 1px solid #dbe4f0;
      border-left: 4px solid #8b9de8;
      border-radius: 16px;
      padding: 20px;
      background: linear-gradient(145deg, #fbfcff 0%, #f4f7fc 100%);
      box-shadow: 0 8px 24px rgba(36, 55, 95, .07);
    }

    .panel-header,
    .ledger-heading,
    .source-card {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .panel-header h3,
    .ledger-heading h4,
    .ledger-heading p { margin: 0; }

    .panel-header h3 { color: #172b4d; font-size: 22px; }
    .panel-subtitle { margin: 5px 0 0; color: #667085; font-size: 13px; }

    .eyebrow,
    .section-label,
    .metric-label,
    .detail-label {
      color: #667085;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .06em;
      text-transform: uppercase;
    }

    .eyebrow { margin-bottom: 5px; color: #5b6cae; }

    .secondary-button {
      background: white;
      color: #40558f;
      border: 1px solid #cbd6ed;
      box-shadow: none;
    }

    .score-overview {
      display: grid;
      grid-template-columns: minmax(170px, .75fr) minmax(0, 1.8fr);
      gap: 12px;
      margin: 20px 0 12px;
    }

    .total-card {
      display: flex;
      min-height: 130px;
      flex-direction: column;
      justify-content: center;
      padding: 18px;
      border: 1px solid #cfdaf7;
      border-radius: 14px;
      background: linear-gradient(145deg, #eef3ff, #ffffff);
    }

    .total-card strong {
      margin: 4px 0 2px;
      color: #243b73;
      font-size: 38px;
      font-weight: 750;
      letter-spacing: -.04em;
    }

    .status-badge { align-self: flex-start; padding: 4px 8px; border-radius: 999px; background: #eaf7ee; color: #13795b; font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
    .status-badge[data-status='calculated'] { background: #eef3ff; color: #40558f; }
    .status-badge[data-status='manual'] { background: #fff4dd; color: #945c00; }
    .recalculation-action { align-self: flex-start; margin-top: 10px; font-size: 12px; }
    .total-card .recalculation-error { margin-top: 6px; color: #b54747; font-size: 12px; }

    .total-note,
    .metric-card small,
    .ledger-heading p,
    .recomputed,
    .state-box span,
    .source-card span,
    .entry-context small,
    .detail-grid p {
      color: #667085;
      font-size: 12px;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .metric-card {
      display: flex;
      min-height: 96px;
      flex-direction: column;
      justify-content: center;
      padding: 14px;
      border: 1px solid #e1e7f0;
      border-radius: 14px;
      background: rgba(255, 255, 255, .8);
    }

    .metric-card strong {
      margin-top: 6px;
      color: #172b4d;
      font-size: 23px;
    }

    .delta-card[data-delta='positive'] { border-color: #b8e5c5; background: #f4fbf6; }
    .delta-card[data-delta='negative'] { border-color: #f2c7c7; background: #fff8f8; }
    .delta-card[data-delta='zero'] { border-color: #c6d8f5; background: #f5f9ff; }
    .delta-card[data-delta='unavailable'] { border-style: dashed; background: #fafbfc; }

    .positive-points { color: #13795b !important; }
    .negative-points { color: #b54747 !important; }

    .consistency-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 12px 0;
      padding: 11px 13px;
      border: 1px solid #cce8d5;
      border-radius: 12px;
      background: #f4fbf6;
    }

    .consistency-row strong,
    .consistency-row span { display: block; }
    .consistency-row > div > span { margin-top: 2px; color: #5e7666; font-size: 12px; }
    .consistency-icon,
    .source-icon,
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

    .consistency-warning { border-color: #f3d39b; background: #fffaf0; }
    .consistency-warning .consistency-icon { background: #ffedc7; color: #a15c00; }

    .source-card {
      align-items: center;
      justify-content: flex-start;
      margin: 14px 0 22px;
      padding: 12px 14px;
      border: 1px solid #e1e7f0;
      border-radius: 12px;
      background: rgba(255, 255, 255, .72);
    }

    .source-icon { background: #e9edff; color: #5368ae; }
    .source-copy { min-width: 0; flex: 1; }
    .source-copy strong { display: block; margin-top: 3px; color: #344054; font-size: 13px; }

    .section-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 10px;
    }

    .section-heading h4 { margin: 3px 0 0; color: #172b4d; font-size: 17px; }
    .muted-note, .section-help { color: #667085; font-size: 12px; }
    .section-help { max-width: 760px; margin: 5px 0 0; line-height: 1.45; }
    .facts-section, .data-section { margin: 22px 0; }

    .facts-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(100px, 1fr));
      gap: 8px;
    }

    .facts-grid > div {
      display: grid;
      gap: 5px;
      padding: 11px 12px;
      border: 1px solid #e1e7f0;
      border-radius: 10px;
      background: #fff;
    }

    .facts-grid span { color: #667085; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .facts-grid strong { color: #172b4d; font-size: 16px; }
    .manual-facts-form { margin: 22px 0 0; padding: 16px; border: 1px solid #d8c68f; border-radius: 12px; background: #fffaf0; }
    .manual-facts-grid { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); gap: 10px; }
    .manual-facts-grid label { display: grid; gap: 5px; color: #475467; font-size: 11px; font-weight: 700; }
    .manual-facts-grid input { min-width: 0; padding: 8px; border: 1px solid #cbd6ed; border-radius: 7px; background: white; }
    .manual-form-actions { display: flex; gap: 8px; margin-top: 14px; }
    .manual-facts-form .recalculation-error { color: #b54747; font-size: 12px; }
    .count-badge { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: #eef3ff; color: #40558f; font-size: 12px; }
    .empty-inline { padding: 14px; border: 1px dashed #c7d2e5; border-radius: 10px; color: #667085; background: #fff; }

    .table-scroll, .raw-table-wrap { overflow-x: auto; border: 1px solid #e1e7f0; border-radius: 10px; background: #fff; }
    .activity-table, .raw-cell-table { width: 100%; min-width: 980px; border-collapse: collapse; font-size: 12px; }
    .activity-table th, .activity-table td, .raw-cell-table th, .raw-cell-table td { padding: 10px 11px; border-bottom: 1px solid #edf0f5; text-align: left; vertical-align: top; }
    .activity-table th, .raw-cell-table thead th { color: #667085; background: #f8fafc; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
    .activity-table tbody tr:last-child td, .raw-cell-table tbody tr:last-child th, .raw-cell-table tbody tr:last-child td { border-bottom: 0; }
    .activity-table td strong { display: block; color: #243b73; }
    .activity-table td small { display: block; margin-top: 3px; color: #667085; }
    .source-badge, .score-link { display: inline-block; padding: 4px 7px; border-radius: 999px; background: #eef3ff; color: #40558f; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .source-badge[data-source='strava'] { background: #fff0e8; color: #b54708; }
    .source-badge[data-source='my_sport_xlsx'] { background: #eaf7ee; color: #13795b; }
    .score-link.daily-fact { background: #eaf7ee; color: #13795b; }
    .score-link.context-only { background: #f2f4f7; color: #667085; }

    .source-record-list { display: grid; gap: 8px; }
    .source-record { border: 1px solid #e1e7f0; border-radius: 10px; background: #fff; }
    .source-record summary { display: flex; align-items: center; gap: 9px; padding: 11px 12px; list-style: none; }
    .source-record summary::-webkit-details-marker { display: none; }
    .source-record summary::before { content: '›'; color: #667085; font-size: 17px; transition: transform .15s ease; }
    .source-record[open] summary::before { transform: rotate(90deg); }
    .source-record summary strong { min-width: 0; color: #344054; overflow-wrap: anywhere; }
    .source-record-meta { margin-left: auto; color: #667085; font-size: 11px; white-space: nowrap; }
    .source-record-body { padding: 0 12px 12px; }
    .source-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 12px; margin: 0 0 10px; font-size: 11px; }
    .source-meta dt { color: #667085; }
    .source-meta dd { margin: 0; overflow-wrap: anywhere; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .raw-cell-table { min-width: 520px; }
    .raw-cell-table th:first-child { width: 260px; }
    .raw-cell-table tbody th { color: #667085; font-weight: 650; background: #fbfcfe; }
    .raw-cell-table td { max-width: 680px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .raw-json { max-height: 420px; margin: 0; padding: 12px; overflow: auto; border-radius: 8px; background: #111827; color: #e5e7eb; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }

    details { margin-top: 6px; }
    summary { cursor: pointer; color: #5267a8; font-size: 12px; font-weight: 700; }
    summary:focus-visible { outline: 3px solid #a8b9ef; outline-offset: 3px; border-radius: 4px; }
    dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 8px 0 0; font-size: 11px; }
    dt { color: #667085; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .hash, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    code { color: #667085; font-size: 11px; }

    .ledger-heading { align-items: end; margin: 20px 0 10px; }
    .ledger-heading h4 { margin-top: 3px; color: #172b4d; font-size: 17px; }
    .ledger-heading p { margin-top: 4px; }
    .recomputed { text-align: right; white-space: nowrap; }

    .ledger-list { display: grid; gap: 10px; }
    .ledger-entry {
      padding: 15px;
      border: 1px solid #e1e7f0;
      border-radius: 14px;
      background: white;
      box-shadow: 0 2px 6px rgba(36, 55, 95, .03);
    }

    .entry-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .rule-copy { display: flex; align-items: flex-start; gap: 9px; min-width: 0; }
    .rule-dot { width: 9px; height: 9px; margin-top: 5px; border-radius: 50%; background: #8b9de8; box-shadow: 0 0 0 4px #eef1ff; }
    .rule-copy strong { display: block; color: #243b73; font-size: 14px; }
    .rule-copy code { display: block; margin-top: 3px; }
    .points-pill { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: #e6f6eb; font-size: 15px; font-weight: 800; }
    .entry-reason { margin: 13px 0 10px; color: #344054; font-size: 14px; line-height: 1.45; }
    .entry-context { display: flex; flex-wrap: wrap; gap: 8px; }
    .entry-context > span { padding: 7px 9px; border-radius: 8px; background: #f7f9fc; color: #475467; font-size: 12px; }
    .entry-context small { display: block; margin-bottom: 2px; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .entry-details { margin-top: 12px; padding-top: 10px; border-top: 1px solid #edf0f5; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
    .detail-grid > div { padding: 9px; border-radius: 8px; background: #f8fafc; }
    .detail-grid p { margin: 4px 0 0; overflow-wrap: anywhere; line-height: 1.45; }
    .imported-calculation { grid-column: 1 / -1; }
    .formula-line { display: grid; gap: 5px; margin-top: 6px; }
    .formula-line > span { color: #667085; font-size: 11px; }
    .formula-line code { display: block; padding: 8px 9px; border: 1px solid #d8e0f1; border-radius: 7px; background: #eef3ff; color: #344b8a; white-space: pre-wrap; overflow-wrap: anywhere; }
    .calculation-equation { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 9px; padding: 10px; border: 1px solid #cddaf4; border-radius: 9px; background: #f5f8ff; }
    .source-evidence-equation { border-style: dashed; background: #fbfcfe; }
    .equation-term { display: grid; gap: 2px; min-width: 76px; }
    .equation-term > span { color: #667085; font-size: 10px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; }
    .equation-term strong { color: #243b73; font-size: 14px; }
    .equation-operator, .equation-arrow { color: #667085; font-weight: 800; }
    .equation-total { color: #172b4d; font-size: 16px; }
    .formula-input-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 7px; margin-top: 9px; }
    .formula-input-grid > span { display: grid; gap: 2px; padding: 7px 8px; border: 1px solid #e1e7f0; border-radius: 7px; background: white; }
    .formula-input-grid small { color: #667085; font-size: 10px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; }
    .formula-input-grid strong { color: #243b73; font-size: 14px; }
    .calculation-note { color: #667085; font-size: 11px; }

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
    .loading-icon { background: #e9edff; color: #5368ae; }
    .error-box { border-color: #efb9b9; background: #fff8f8; }
    .error-box .state-icon { background: #ffe2e2; color: #b54747; }
    .error-box button { margin-left: auto; }

    @media (max-width: 900px) {
      .score-overview { grid-template-columns: 1fr; }
      .facts-grid { grid-template-columns: repeat(3, minmax(100px, 1fr)); }
      .manual-facts-grid { grid-template-columns: repeat(2, minmax(130px, 1fr)); }
    }

    @media (max-width: 680px) {
      .breakdown-panel { padding: 14px; }
      .metric-grid, .detail-grid { grid-template-columns: 1fr 1fr; }
      .panel-header, .ledger-heading { align-items: stretch; flex-direction: column; }
      .recomputed { text-align: left; }
      .facts-grid { grid-template-columns: repeat(2, minmax(100px, 1fr)); }
      .manual-facts-grid { grid-template-columns: 1fr; }
      .section-heading { flex-direction: column; }
      .source-record-meta { margin-left: 0; }
    }

    @media (max-width: 460px) {
      .metric-grid, .detail-grid { grid-template-columns: 1fr; }
      .entry-top { flex-direction: column; }
    }
  `],
})
export class ScoreBreakdownPanelComponent {
  readonly state = input<ScoreBreakdownViewState>('idle');
  readonly date = input<string | null>(null);
  readonly breakdown = input<DailyScoreBreakdown | null>(null);
  readonly errorMessage = input<string | null>(null);
  readonly recalculating = input(false);
  readonly recalculationError = input<string | null>(null);
  readonly savingManual = input(false);
  readonly manualSaveError = input<string | null>(null);
  readonly retry = output<void>();
  readonly recalculate = output<void>();
  readonly saveManualFacts = output<ManualDailyFactsInput>();
  readonly closed = output<void>();

  readonly editingManual = signal(false);
  readonly manualValidationError = signal<string | null>(null);
  readonly manualSteps = signal(0);
  readonly manualRunKm = signal(0);
  readonly manualRunIndoorKm = signal(0);
  readonly manualRunOutdoorKm = signal(0);
  readonly manualBikeKm = signal(0);
  readonly manualBikeIndoorKm = signal(0);
  readonly manualBikeOutdoorKm = signal(0);
  readonly manualSwimM = signal(0);
  readonly manualWorkoutPoints = signal(0);
  readonly manualPowerPoints = signal(0);

  readonly headingId = 'daily-score-breakdown-heading';
  private readonly numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

  deltaKind(delta: number | null): DeltaKind {
    if (delta === null) return 'unavailable';
    if (delta > 0) return 'positive';
    if (delta < 0) return 'negative';
    return 'zero';
  }

  deltaValue(delta: number | null): string {
    if (delta === null) return 'Not available';
    if (delta > 0) return `+${this.formatNumber(delta)}`;
    if (delta < 0) return `−${this.formatNumber(Math.abs(delta))}`;
    return '0';
  }

  deltaDescription(delta: number | null): string {
    if (delta === null) return 'No spreadsheet total was imported';
    if (delta > 0) return 'App total is above Excel';
    if (delta < 0) return 'App total is below Excel';
    return 'App and Excel totals match';
  }

  scoreStatusLabel(status: DailyScoreBreakdown['scoreStatus']): string {
    return status === 'imported' ? 'Imported ledger' : status === 'manual' ? 'Manual edit' : 'Calculated';
  }

  scoreAuthorityNote(status: DailyScoreBreakdown['scoreStatus']): string {
    if (status === 'imported') return 'Imported ledger is authoritative';
    if (status === 'manual') return 'Saved manual facts are authoritative';
    return 'Calculated from canonical activities';
  }

  startManualEdit(current: DailyScoreBreakdown | null): void {
    const facts = current?.facts;
    this.manualSteps.set(facts?.steps ?? 0);
    this.manualRunKm.set((facts?.runM ?? 0) / 1000);
    this.manualRunIndoorKm.set((facts?.runIndoorM ?? 0) / 1000);
    this.manualRunOutdoorKm.set((facts?.runOutdoorM ?? 0) / 1000);
    this.manualBikeKm.set((facts?.bikeM ?? 0) / 1000);
    this.manualBikeIndoorKm.set((facts?.bikeIndoorM ?? 0) / 1000);
    this.manualBikeOutdoorKm.set((facts?.bikeOutdoorM ?? 0) / 1000);
    this.manualSwimM.set(facts?.swimM ?? 0);
    this.manualWorkoutPoints.set(facts?.workoutPoints ?? 0);
    this.manualPowerPoints.set(facts?.powerPoints ?? 0);
    this.manualValidationError.set(null);
    this.editingManual.set(true);
  }

  submitManualFacts(): void {
    const values = [
      this.manualSteps(), this.manualRunKm(), this.manualRunIndoorKm(), this.manualRunOutdoorKm(),
      this.manualBikeKm(), this.manualBikeIndoorKm(), this.manualBikeOutdoorKm(), this.manualSwimM(),
      this.manualWorkoutPoints(), this.manualPowerPoints(),
    ];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      this.manualValidationError.set('Every value must be a non-negative number.');
      return;
    }
    if (![this.manualSteps(), this.manualWorkoutPoints(), this.manualPowerPoints()].every(Number.isInteger)) {
      this.manualValidationError.set('Steps, workout points, and power points must be whole numbers.');
      return;
    }
    if (this.manualRunIndoorKm() + this.manualRunOutdoorKm() > this.manualRunKm() + 1e-9) {
      this.manualValidationError.set('Run treadmill and outdoor distances cannot exceed the run total.');
      return;
    }
    if (this.manualBikeIndoorKm() + this.manualBikeOutdoorKm() > this.manualBikeKm() + 1e-9) {
      this.manualValidationError.set('Bike indoor and outdoor distances cannot exceed the bike total.');
      return;
    }
    this.manualValidationError.set(null);
    this.saveManualFacts.emit({
      steps: this.manualSteps(),
      runM: this.manualRunKm() * 1000,
      runIndoorM: this.manualRunIndoorKm() * 1000,
      runOutdoorM: this.manualRunOutdoorKm() * 1000,
      bikeM: this.manualBikeKm() * 1000,
      bikeIndoorM: this.manualBikeIndoorKm() * 1000,
      bikeOutdoorM: this.manualBikeOutdoorKm() * 1000,
      swimM: this.manualSwimM(),
      workoutPoints: this.manualWorkoutPoints(),
      powerPoints: this.manualPowerPoints(),
    });
  }

  formatNumber(value: number): string {
    return this.numberFormatter.format(value);
  }

  formatDate(value: string | null | undefined): string {
    return formatDate(value);
  }

  formatTimestamp(value: string | null | undefined, fallback = 'Not available'): string {
    return formatDateTime(value, fallback);
  }

  formatDistance(meters: number | null | undefined, fractionDigits = 2): string {
    if (meters === null || meters === undefined) return '—';
    return `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: fractionDigits })} km`;
  }

  formatDurationValue(seconds: number): string {
    return this.formatDuration(seconds);
  }

  formatPace(secondsPerKm: number): string {
    const rounded = Math.max(0, Math.round(secondsPerKm));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/km`;
  }

  formatSpeed(metersPerSecond: number): string {
    return `${(metersPerSecond * 3.6).toLocaleString('en-US', { maximumFractionDigits: 2 })} km/h`;
  }

  formatSigned(value: number): string {
    if (value > 0) return `+${this.formatNumber(value)}`;
    if (value < 0) return `−${this.formatNumber(Math.abs(value))}`;
    return '0';
  }

  ledgerSum(breakdown: DailyScoreBreakdown): number {
    return breakdown.ledger.reduce((sum, entry) => sum + entry.points, 0);
  }

  ledgerMatchesAppTotal(breakdown: DailyScoreBreakdown): boolean {
    return this.ledgerSum(breakdown) === breakdown.score.appTotal;
  }

  importedLedgerDetails(
    entry: ScoreBreakdownLedgerEntry,
    breakdown: DailyScoreBreakdown,
  ): ImportedLedgerDetails | null {
    if (breakdown.scoreStatus !== 'imported' || entry.rule !== null || entry.activity !== null) return null;

    const calculation = this.jsonRecord(entry.calculation);
    const formula = this.jsonString(calculation?.workbookFormula) ?? this.sourceWorkbookFormula(breakdown.sourceRecord);
    const persistedInputs = this.formulaInputsFromJson(calculation?.workbookFormulaInputs);
    const inputs = persistedInputs.length > 0
      ? persistedInputs
      : formula
        ? this.formulaInputsFromSource(formula, breakdown.sourceRecord)
        : this.candidateWorkbookInputs(breakdown.sourceRecord);
    const persistedAdditive = this.jsonBoolean(calculation?.workbookFormulaIsAdditive);
    const additiveFormula = persistedAdditive ?? (formula !== null && this.isAdditiveWorkbookFormula(formula));
    const inputTotal = inputs.length > 0 ? inputs.reduce((sum, input) => sum + input.value, 0) : null;
    const matchesTotal = inputTotal !== null && Math.abs(inputTotal - entry.points) < 1e-9;

    return {
      formula,
      inputs,
      additiveFormula,
      showEquation: inputs.length > 0 && (additiveFormula || (formula === null && matchesTotal)),
      inputTotal,
      matchesTotal,
    };
  }

  formatWorkbookFormula(value: string): string {
    const formula = value.trim();
    return formula.startsWith('=') ? formula : `=${formula}`;
  }

  importedEquationLabel(details: ImportedLedgerDetails, importedTotal: number): string {
    const terms = details.inputs
      .map((input) => `${input.label} ${this.formatNumber(input.value)}`)
      .join(' plus ');
    const inputTotal = details.inputTotal === null ? 'unavailable' : this.formatNumber(details.inputTotal);
    return `${details.formula ? 'Workbook formula inputs' : 'Available cached workbook values'}: ${terms} equals ${inputTotal}; imported All ${this.formatNumber(importedTotal)}`;
  }

  private formulaInputsFromJson(value: JsonValue | undefined): ImportedLedgerInput[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) => {
      const record = this.jsonRecord(item);
      const sourceColumn = this.jsonString(record?.sourceColumn);
      const numericValue = this.jsonNumber(record?.value);
      if (!sourceColumn || numericValue === null) return [];
      const reference = this.jsonString(record?.cellReference);
      return [{
        key: `persisted:${sourceColumn}:${reference ?? index}`,
        label: this.workbookColumnLabel(sourceColumn),
        reference,
        value: numericValue,
      }];
    });
  }

  private sourceWorkbookFormula(source: SourceRecordReference | null): string | null {
    const sourceRecord = this.jsonRecord(source?.rawJson);
    const formulas = this.jsonRecord(sourceRecord?.formulas);
    return this.jsonString(formulas?.all);
  }

  private formulaInputsFromSource(formula: string, source: SourceRecordReference | null): ImportedLedgerInput[] {
    const workbook = this.workbookSourceData(source);
    const rowIndex = source?.rowIndex;
    if (!workbook || rowIndex === null || rowIndex === undefined) return [];

    const inputs: ImportedLedgerInput[] = [];
    const seen = new Set<string>();
    const referencePattern = /\$?([A-Z]{1,3})\$?(\d+)/gi;
    for (const match of formula.matchAll(referencePattern)) {
      const columnLetters = match[1];
      const referencedRow = Number(match[2]);
      if (!columnLetters || referencedRow !== rowIndex) continue;

      const columnIndex = this.excelColumnIndex(columnLetters);
      const sourceColumn = this.workbookKey(workbook.headers[columnIndex]);
      const numericValue = this.sourceNumber(workbook.cells[columnIndex]);
      const reference = match[0].replaceAll('$', '').toUpperCase();
      if (!sourceColumn || numericValue === null || seen.has(reference)) continue;

      seen.add(reference);
      inputs.push({
        key: `source:${sourceColumn}:${reference}`,
        label: this.workbookColumnLabel(sourceColumn),
        reference,
        value: numericValue,
      });
    }
    return inputs;
  }

  private candidateWorkbookInputs(source: SourceRecordReference | null): ImportedLedgerInput[] {
    const workbook = this.workbookSourceData(source);
    if (!workbook) return [];

    const scoreColumns = new Set(['steps', 'run_to_s', 'bike_to_s', 'sup_to_s', 'raw_to_s', 'swim_to_s', 'wototal', 'pow']);
    const seen = new Set<string>();
    return workbook.headers.flatMap((header, index) => {
      const sourceColumn = this.workbookKey(header);
      const numericValue = this.sourceNumber(workbook.cells[index]);
      if (!scoreColumns.has(sourceColumn) || numericValue === null || numericValue === 0 || seen.has(sourceColumn)) return [];
      seen.add(sourceColumn);
      return [{
        key: `candidate:${sourceColumn}:${index}`,
        label: this.workbookColumnLabel(sourceColumn),
        reference: null,
        value: numericValue,
      }];
    });
  }

  private workbookSourceData(source: SourceRecordReference | null): { headers: JsonValue[]; cells: JsonValue[] } | null {
    const record = this.jsonRecord(source?.rawJson);
    const headers = record?.headers;
    const cells = record?.cells;
    return Array.isArray(headers) && Array.isArray(cells) ? { headers, cells } : null;
  }

  private workbookKey(value: JsonValue | undefined): string {
    if (value === null || value === undefined || typeof value === 'object') return '';
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]+/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private workbookColumnLabel(sourceColumn: string): string {
    const labels: Record<string, string> = {
      steps: 'Steps',
      run: 'Run',
      bike: 'Bike',
      swim: 'Swim',
      run_to_s: 'Run to S',
      bike_to_s: 'Bike to S',
      sup_to_s: 'SUP to S',
      raw_to_s: 'Rowing to S',
      swim_to_s: 'Swim to S',
      wototal: 'WOtotal',
      hiit: 'HIIT',
      raw: 'Rowing',
      sup: 'SUP',
      pow: 'Pow',
    };
    return labels[sourceColumn] ?? this.humanize(sourceColumn);
  }

  private sourceNumber(value: JsonValue | undefined): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private excelColumnIndex(columnLetters: string): number {
    let value = 0;
    for (const character of columnLetters.toUpperCase()) {
      value = value * 26 + character.charCodeAt(0) - 64;
    }
    return value - 1;
  }

  private isAdditiveWorkbookFormula(formula: string): boolean {
    return /^\s*=?\s*\$?[A-Z]{1,3}\$?\d+(?:\s*\+\s*\$?[A-Z]{1,3}\$?\d+)*\s*$/i.test(formula);
  }

  private jsonString(value: JsonValue | undefined): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private jsonNumber(value: JsonValue | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private jsonBoolean(value: JsonValue | undefined): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  calculationLabel(value: JsonValue): string {
    if (value === null) return 'No calculation inputs';
    if (Array.isArray(value)) return value.map((item) => this.calculationLabel(item)).join(', ');
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      return entries.length === 0
        ? 'No calculation inputs'
        : entries.map(([key, item]) => `${this.humanize(key)}: ${this.calculationLabel(item)}`).join(' · ');
    }
    return String(value);
  }

  activityLabel(activity: ScoreBreakdownActivity | null): string {
    if (!activity) return 'No linked activity';
    const parts = [this.humanize(activity.activityType), activity.subtype ? this.humanize(activity.subtype) : null];
    if (activity.distanceM !== null) parts.push(`${this.formatNumber(activity.distanceM / 1000)} km`);
    if (activity.durationS !== null) parts.push(this.formatDuration(activity.durationS));
    if (activity.steps !== null) parts.push(`${this.formatNumber(activity.steps)} steps`);
    if (activity.effortPoints !== null) parts.push(`${this.formatNumber(activity.effortPoints)} effort`);
    return parts.filter((part): part is string => Boolean(part)).join(' · ');
  }

  activityName(activity: ScoreBreakdownActivity): string {
    const parts = [this.humanize(activity.activityType), activity.subtype ? this.humanize(activity.subtype) : null];
    return parts.filter((part): part is string => Boolean(part)).join(' · ');
  }

  sourceName(source: string): string {
    if (source === 'my_sport_xlsx') return 'Excel';
    if (source === 'strava' || source === 'strava_api') return 'Strava';
    if (source === 'run_db_xlsx') return 'Run DB';
    if (source === 'manual' || source === 'manual_daily_edit') return 'Manual';
    return this.humanize(source);
  }

  activityIsInLedger(activity: ScoreBreakdownActivity, breakdown: DailyScoreBreakdown): boolean {
    return breakdown.ledger.some((entry) => entry.activity?.id === activity.id);
  }

  activityScoreLabel(activity: ScoreBreakdownActivity, breakdown: DailyScoreBreakdown): string {
    if (this.activityIsInLedger(activity, breakdown)) return 'In ledger';
    if (breakdown.scoreStatus === 'manual' && activity.source === 'manual') return 'Daily fact';
    if (activity.source === 'my_sport_xlsx') return 'Daily fact';
    return 'Context only';
  }

  sourceRecordTitle(record: SourceRecordReference): string {
    const location = record.sheetName
      ? `${record.sheetName}${record.rowIndex === null ? '' : ` row ${record.rowIndex}`}`
      : record.normalizedEntityId || 'provider activity';
    return `${record.batch.filename || this.sourceName(record.batch.source)} · ${location}`;
  }

  hasWorkbookCells(value: JsonValue): boolean {
    return this.workbookCells(value).length > 0;
  }

  workbookCells(value: JsonValue): JsonValue[] {
    const record = this.jsonRecord(value);
    return Array.isArray(record?.cells) ? record.cells : [];
  }

  workbookHeader(value: JsonValue, index: number): string {
    const record = this.jsonRecord(value);
    const headers = Array.isArray(record?.headers) ? record.headers : [];
    const header = headers[index];
    return header === null || header === undefined || header === '' ? `Column ${index + 1}` : String(header).replace(/\n/g, ' ');
  }

  rawValueLabel(value: JsonValue): string {
    if (value !== null && typeof value === 'object') return this.jsonLabel(value);
    return value === null ? 'null' : String(value);
  }

  jsonLabel(value: JsonValue): string {
    return JSON.stringify(value, null, 2) ?? String(value);
  }

  sourceSummary(source: SourceRecordReference | null): string {
    if (!source) return 'Source link unavailable';
    if (source.batch.source === 'manual_daily_edit') return 'Manual daily facts';
    const workbook = source.batch.filename || source.batch.source;
    const location = source.sheetName
      ? `${source.sheetName}${source.rowIndex === null ? '' : ` row ${source.rowIndex}`}`
      : source.rowIndex === null ? 'row unavailable' : `row ${source.rowIndex}`;
    return `${workbook} · ${location}`;
  }

  ruleLabel(entry: ScoreBreakdownLedgerEntry): string {
    return entry.rule ? `${entry.rule.name} (${entry.rule.code})` : 'Rule unavailable';
  }

  private formatDuration(seconds: number): string {
    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainingSeconds = rounded % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
      : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  private humanize(value: string): string {
    return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }

  private jsonRecord(value: JsonValue | undefined): { [key: string]: JsonValue } | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as { [key: string]: JsonValue }
      : null;
  }
}
