import { Component, computed, inject, input, output, signal, type OnChanges, type OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { DailyScoreBreakdown, ManualDailyFactsInput } from './score-breakdown.models';
import { formatScoreDate } from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-manual-facts',
  standalone: true,
  template: `
    @if (active() && editing()) {
      <div
        class="manual-dialog-layer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-facts-title"
        (keydown.escape)="cancelManualEdit()">
        <div class="manual-dialog-scrim" aria-hidden="true" (click)="cancelManualEdit()"></div>
        <form class="manual-facts-form" (submit)="submitManualFacts(); $event.preventDefault()">
          <div class="section-heading">
            <div>
              <span class="section-label">Manual canonical entry</span>
              <h4 id="manual-facts-title">{{ breakdown() ? 'Replace the current daily facts' : 'Create daily facts for ' + formatScoreDate(date()) }}</h4>
              <p class="section-help">Enter the daily facts. Distances are retained as manual activities.</p>
            </div>
            <button type="button" class="dialog-close" aria-label="Close manual facts editor" [disabled]="saving()" (click)="cancelManualEdit()">×</button>
          </div>
          <div class="manual-facts-grid">
            <label>{{ useTotalSteps() ? 'All-day steps' : 'Steps (excluding runs)' }} <input autofocus type="number" min="0" step="1" [value]="manualSteps()" (input)="manualSteps.set(numberInputValue($event))" /></label>
            <label>Run outdoor (km) <input type="number" min="0" step="0.01" [value]="manualRunOutdoorKm()" (input)="manualRunOutdoorKm.set(numberInputValue($event))" /></label>
            <label>Bike outdoor (km) <input type="number" min="0" step="0.01" [value]="manualBikeOutdoorKm()" (input)="manualBikeOutdoorKm.set(numberInputValue($event))" /></label>
            <label>Swim (m) <input type="number" min="0" step="1" [value]="manualSwimM()" (input)="manualSwimM.set(numberInputValue($event))" /></label>
            <label>Workout points <input type="number" min="0" step="1" [value]="manualWorkoutPoints()" (input)="manualWorkoutPoints.set(numberInputValue($event))" /></label>
            <label>Bonus points <input type="number" min="0" step="1" [value]="manualBonusPoints()" (input)="manualBonusPoints.set(numberInputValue($event))" /></label>
          </div>
          <label class="steps-option"><input type="checkbox" [checked]="useTotalSteps()" (change)="useTotalSteps.set($any($event.target).checked)" /> My step count includes running; subtract estimated run steps</label>
          @if (useTotalSteps()) {
            <p class="steps-preview" role="status">
              @if (estimateLoading()) { Loading run estimate… }
              @else if (estimateError()) { {{ estimateError() }} }
              @else { {{ manualSteps() }} all-day − {{ estimatedRunningSteps() }} from synced Strava runs = <strong>{{ adjustedSteps() }} steps scored</strong>
                @if (unestimatedRunCount()) { · {{ unestimatedRunCount() }} run(s) lack enough data for an estimate. }
              }
            </p>
          }
          <details class="more-fields">
            <summary>More activity types</summary>
            <div class="manual-facts-grid">
              <label>Run treadmill (km) <input type="number" min="0" step="0.01" [value]="manualRunIndoorKm()" (input)="manualRunIndoorKm.set(numberInputValue($event))" /></label>
              <label>Run unspecified (km) <input type="number" min="0" step="0.01" [value]="manualRunUnspecifiedKm()" (input)="manualRunUnspecifiedKm.set(numberInputValue($event))" /></label>
              <label>Bike indoor (km) <input type="number" min="0" step="0.01" [value]="manualBikeIndoorKm()" (input)="manualBikeIndoorKm.set(numberInputValue($event))" /></label>
              <label>Bike unspecified (km) <input type="number" min="0" step="0.01" [value]="manualBikeUnspecifiedKm()" (input)="manualBikeUnspecifiedKm.set(numberInputValue($event))" /></label>
            </div>
          </details>
          @if (validationError()) { <p class="recalculation-error" role="alert">{{ validationError() }}</p> }
          @if (saveError()) { <p class="recalculation-error" role="alert">{{ saveError() }}</p> }
          <div class="manual-form-actions">
            <button type="submit" [disabled]="saving() || (useTotalSteps() && (estimateLoading() || !!estimateError()))">{{ saving() ? 'Saving…' : 'Save manual facts' }}</button>
            <button type="button" class="secondary-button" [disabled]="saving()" (click)="cancelManualEdit()">Cancel</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .manual-dialog-layer { position: fixed; z-index: 400; inset: 0; display: grid; place-items: center; padding: 20px; box-sizing: border-box; }
    .manual-dialog-scrim { position: absolute; inset: 0; background: rgba(23, 32, 51, .34); backdrop-filter: blur(2px); }
    .manual-facts-form { position: relative; width: min(920px, 100%); max-height: min(720px, calc(100vh - 40px)); overflow-y: auto; box-sizing: border-box; padding: 22px; border: 1px solid #e2d5ae; border-radius: 16px; background: #fffdf8; box-shadow: 0 24px 70px rgba(23, 32, 51, .25); }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .section-heading h4 { margin: 3px 0 0; color: #172b4d; font-size: 17px; }
    .section-label { color: #667085; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .section-help { max-width: 760px; margin: 5px 0 0; color: #667085; font-size: 12px; line-height: 1.45; }
    .manual-facts-grid { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); gap: 10px; }
    .manual-facts-grid label { display: grid; gap: 5px; color: #475467; font-size: 11px; font-weight: 700; }
    .manual-facts-grid input { min-width: 0; padding: 8px; border: 1px solid #cbd6ed; border-radius: 7px; background: white; }
    .steps-option { display: flex; align-items: center; gap: 8px; margin-top: 14px; color: #344054; font-size: 12px; font-weight: 650; }
    .steps-preview { margin: 8px 0 0; padding: 10px 12px; border-radius: 8px; background: #eef3ff; color: #243b73; font-size: 12px; }
    .more-fields { margin-top: 14px; border-top: 1px solid #e1e7f0; padding-top: 12px; }
    .more-fields summary { cursor: pointer; color: #40558f; font-size: 12px; font-weight: 750; }
    .more-fields .manual-facts-grid { margin-top: 12px; }
    .manual-form-actions { display: flex; gap: 8px; margin-top: 14px; }
    .recalculation-error { color: #b54747; font-size: 12px; }
    .secondary-button { background: white; color: #40558f; border: 1px solid #cbd6ed; box-shadow: none; }
    .dialog-close { flex: 0 0 auto; width: 34px; height: 34px; padding: 0; border: 1px solid #d0d5dd; border-radius: 50%; background: white; color: #475467; font-size: 21px; line-height: 1; }
    @media (max-width: 900px) { .manual-facts-grid { grid-template-columns: repeat(2, minmax(130px, 1fr)); } }
    @media (max-width: 520px) {
      .manual-dialog-layer { padding: 10px; }
      .manual-facts-form { max-height: calc(100vh - 20px); padding: 16px; }
      .manual-facts-grid { grid-template-columns: 1fr; }
      .section-heading { flex-direction: column; }
      .manual-form-actions { display: grid; grid-template-columns: 1fr; }
    }
  `],
})
export class ScoreBreakdownManualFactsComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ScoreBreakdownApiService, { optional: true });
  private estimateSubscription?: Subscription;
  readonly active = input(false);
  readonly date = input<string | null>(null);
  readonly breakdown = input<DailyScoreBreakdown | null>(null);
  readonly saving = input(false);
  readonly saveError = input<string | null>(null);
  readonly editRequestId = input(0);
  readonly save = output<ManualDailyFactsInput>();

  readonly editing = signal(false);
  readonly validationError = signal<string | null>(null);
  readonly manualSteps = signal(0);
  readonly useTotalSteps = signal(false);
  readonly estimatedRunningSteps = signal(0);
  readonly unestimatedRunCount = signal(0);
  readonly estimateLoading = signal(false);
  readonly estimateError = signal<string | null>(null);
  readonly adjustedSteps = computed(() => Math.max(this.manualSteps() - this.estimatedRunningSteps(), 0));
  readonly manualRunIndoorKm = signal(0);
  readonly manualRunOutdoorKm = signal(0);
  readonly manualRunUnspecifiedKm = signal(0);
  readonly manualBikeIndoorKm = signal(0);
  readonly manualBikeOutdoorKm = signal(0);
  readonly manualBikeUnspecifiedKm = signal(0);
  readonly manualSwimM = signal(0);
  readonly manualWorkoutPoints = signal(0);
  readonly manualBonusPoints = signal(0);

  readonly formatScoreDate = formatScoreDate;
  private handledEditRequestId = 0;

  ngOnChanges(): void {
    if (!this.active()) {
      this.editing.set(false);
      return;
    }
    const requestId = this.editRequestId();
    if (requestId <= this.handledEditRequestId) return;
    this.handledEditRequestId = requestId;
    this.startManualEdit(this.breakdown());
  }

  ngOnDestroy(): void { this.estimateSubscription?.unsubscribe(); }

  startManualEdit(current: DailyScoreBreakdown | null): void {
    const facts = current?.facts;
    const priorCalculation = facts?.stepsCalculation;
    this.useTotalSteps.set(priorCalculation?.source === 'manual_adjusted');
    this.manualSteps.set(priorCalculation?.source === 'manual_adjusted' ? priorCalculation.totalSteps ?? facts?.steps ?? 0 : facts?.steps ?? 0);
    this.estimatedRunningSteps.set(priorCalculation?.estimatedRunningSteps ?? 0);
    this.unestimatedRunCount.set(priorCalculation?.unestimatedRunCount ?? 0);
    this.estimateSubscription?.unsubscribe();
    this.estimateLoading.set(!!this.api && !!this.date());
    this.estimateError.set(null);
    const date = this.date();
    if (this.api && date) this.estimateSubscription = this.api.runningStepEstimate(date).subscribe({
      next: (estimate) => {
        this.estimatedRunningSteps.set(estimate.estimatedRunningSteps);
        this.unestimatedRunCount.set(estimate.unestimatedRunCount);
        this.estimateLoading.set(false);
      },
      error: () => { this.estimateError.set('Run-step estimate could not be loaded.'); this.estimateLoading.set(false); },
    });
    else this.estimateLoading.set(false);
    const runIndoorM = facts?.runIndoorM ?? 0;
    const runOutdoorM = facts?.runOutdoorM ?? 0;
    const bikeIndoorM = facts?.bikeIndoorM ?? 0;
    const bikeOutdoorM = facts?.bikeOutdoorM ?? 0;
    this.manualRunIndoorKm.set(runIndoorM / 1000);
    this.manualRunOutdoorKm.set(runOutdoorM / 1000);
    this.manualRunUnspecifiedKm.set(this.remainderDistanceKm(facts?.runM, runIndoorM, runOutdoorM, facts?.runUnspecifiedM));
    this.manualBikeIndoorKm.set(bikeIndoorM / 1000);
    this.manualBikeOutdoorKm.set(bikeOutdoorM / 1000);
    this.manualBikeUnspecifiedKm.set(this.remainderDistanceKm(facts?.bikeM, bikeIndoorM, bikeOutdoorM, facts?.bikeUnspecifiedM));
    this.manualSwimM.set(facts?.swimM ?? 0);
    this.manualWorkoutPoints.set(facts?.workoutPoints ?? 0);
    this.manualBonusPoints.set(current?.score.bonusPoints ?? 0);
    this.validationError.set(null);
    this.editing.set(true);
  }

  cancelManualEdit(): void {
    if (!this.saving()) this.editing.set(false);
  }

  submitManualFacts(): void {
    const fields: Array<readonly [label: string, value: number]> = [
      ['Steps', this.manualSteps()],
      ['Run treadmill', this.manualRunIndoorKm()],
      ['Run outdoor', this.manualRunOutdoorKm()],
      ['Run unspecified', this.manualRunUnspecifiedKm()],
      ['Bike indoor', this.manualBikeIndoorKm()],
      ['Bike outdoor', this.manualBikeOutdoorKm()],
      ['Bike unspecified', this.manualBikeUnspecifiedKm()],
      ['Swim', this.manualSwimM()],
      ['Workout points', this.manualWorkoutPoints()],
      ['Bonus points', this.manualBonusPoints()],
    ];
    const invalidField = fields.find(([, value]) => !Number.isFinite(value) || value < 0);
    if (invalidField) {
      this.validationError.set(`${invalidField[0]} must be a non-negative number.`);
      return;
    }
    if (![this.manualSteps(), this.manualWorkoutPoints(), this.manualBonusPoints()].every(Number.isInteger)) {
      this.validationError.set('Steps, workout points, and bonus points must be whole numbers.');
      return;
    }
    if (this.useTotalSteps() && (this.estimateLoading() || this.estimateError())) return;
    this.validationError.set(null);
    this.save.emit({
      steps: this.useTotalSteps() ? this.adjustedSteps() : this.manualSteps(),
      ...(this.useTotalSteps() ? { totalSteps: this.manualSteps() } : {}),
      runIndoorM: this.kilometersToMeters(this.manualRunIndoorKm()),
      runOutdoorM: this.kilometersToMeters(this.manualRunOutdoorKm()),
      runUnspecifiedM: this.kilometersToMeters(this.manualRunUnspecifiedKm()),
      bikeIndoorM: this.kilometersToMeters(this.manualBikeIndoorKm()),
      bikeOutdoorM: this.kilometersToMeters(this.manualBikeOutdoorKm()),
      bikeUnspecifiedM: this.kilometersToMeters(this.manualBikeUnspecifiedKm()),
      swimM: this.manualSwimM(),
      workoutPoints: this.manualWorkoutPoints(),
      bonusPoints: this.manualBonusPoints(),
    });
  }

  numberInputValue(event: Event): number {
    const input = event.target as HTMLInputElement;
    return input.value.trim() === '' ? 0 : input.valueAsNumber;
  }

  private kilometersToMeters(value: number): number {
    return Math.round(value * 1_000_000) / 1000;
  }

  private remainderDistanceKm(
    totalM: number | null | undefined,
    indoorM: number,
    outdoorM: number,
    unspecifiedM: number | null | undefined,
  ): number {
    if (unspecifiedM !== null && unspecifiedM !== undefined && unspecifiedM > 0) return unspecifiedM / 1000;
    return Math.max((totalM ?? 0) - indoorM - outdoorM, 0) / 1000;
  }
}
