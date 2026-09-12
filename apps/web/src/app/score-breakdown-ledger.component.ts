import { Component, input } from '@angular/core';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import {
  activityLabel,
  calculationLabel,
  formatNumber,
  formatScoreDate,
  formatSigned,
  formatTimestamp,
  formatWorkbookFormula,
  importedEquationLabel,
  importedLedgerDetails,
  sourceSummary,
} from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-ledger',
  standalone: true,
  template: `
    @let current = breakdown();
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
                    <p>{{ formatScoreDate(entry.rule.validFrom) }}{{ entry.rule.validTo ? ' – ' + formatScoreDate(entry.rule.validTo) : ' onward' }}</p>
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
  `,
  styles: [`
    .ledger-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin: 20px 0 10px; }
    .ledger-heading h4, .ledger-heading p { margin: 0; }
    .ledger-heading h4 { margin-top: 3px; color: #172b4d; font-size: 17px; }
    .ledger-heading p { margin-top: 4px; color: #667085; font-size: 12px; }
    .section-label, .detail-label { color: #667085; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .recomputed { color: #667085; font-size: 12px; text-align: right; white-space: nowrap; }
    .ledger-list { display: grid; gap: 10px; }
    .ledger-entry { padding: 15px; border: 1px solid #e1e7f0; border-radius: 14px; background: white; box-shadow: 0 2px 6px rgba(36, 55, 95, .03); }
    .entry-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .rule-copy { display: flex; align-items: flex-start; gap: 9px; min-width: 0; }
    .rule-dot { width: 9px; height: 9px; margin-top: 5px; border-radius: 50%; background: #8b9de8; box-shadow: 0 0 0 4px #eef1ff; }
    .rule-copy strong { display: block; color: #243b73; font-size: 14px; }
    .rule-copy code { display: block; margin-top: 3px; }
    .points-pill { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: #e6f6eb; font-size: 15px; font-weight: 800; }
    .positive-points { color: #13795b !important; }
    .negative-points { color: #b54747 !important; }
    .entry-reason { margin: 13px 0 10px; color: #344054; font-size: 14px; line-height: 1.45; }
    .entry-context { display: flex; flex-wrap: wrap; gap: 8px; }
    .entry-context > span { padding: 7px 9px; border-radius: 8px; background: #f7f9fc; color: #475467; font-size: 12px; }
    .entry-context small { display: block; margin-bottom: 2px; color: #667085; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .entry-details { margin-top: 12px; padding-top: 10px; border-top: 1px solid #edf0f5; }
    details { margin-top: 6px; }
    summary { cursor: pointer; color: #5267a8; font-size: 12px; font-weight: 700; }
    summary:focus-visible { outline: 3px solid #a8b9ef; outline-offset: 3px; border-radius: 4px; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
    .detail-grid > div { padding: 9px; border-radius: 8px; background: #f8fafc; }
    .detail-grid p { margin: 4px 0 0; color: #667085; font-size: 12px; overflow-wrap: anywhere; line-height: 1.45; }
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
    code { color: #667085; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .state-box { display: flex; align-items: flex-start; gap: 11px; padding: 18px; border: 1px dashed #c7d2e5; border-radius: 14px; background: white; }
    .state-box span { color: #667085; font-size: 12px; }
    @media (max-width: 680px) {
      .ledger-heading { align-items: stretch; flex-direction: column; }
      .recomputed { text-align: left; }
      .detail-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 460px) {
      .detail-grid { grid-template-columns: 1fr; }
      .entry-top { flex-direction: column; }
    }
  `],
})
export class ScoreBreakdownLedgerComponent {
  readonly breakdown = input.required<DailyScoreBreakdown>();

  readonly activityLabel = activityLabel;
  readonly calculationLabel = calculationLabel;
  readonly formatNumber = formatNumber;
  readonly formatScoreDate = formatScoreDate;
  readonly formatSigned = formatSigned;
  readonly formatTimestamp = formatTimestamp;
  readonly formatWorkbookFormula = formatWorkbookFormula;
  readonly importedEquationLabel = importedEquationLabel;
  readonly importedLedgerDetails = importedLedgerDetails;
  readonly sourceSummary = sourceSummary;
}
