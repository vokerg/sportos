import { Component, input, output, signal, type OnChanges } from '@angular/core';
import type { DailyScoreBreakdown, ManualDailyFactsInput } from './score-breakdown.models';
import { formatDate } from './date-time';

@Component({
  selector: 'sportos-score-breakdown-manual-facts',
  standalone: true,
  template: `
    @if (active() && (editing() || showWhenEmpty())) {
      <form class="manual-facts-form" (submit)="submitManualFacts(); $event.preventDefault()">
        <div class="section-heading">
          <div>
            <span class="section-label">Manual canonical entry</span>
            <h4>{{ breakdown() ? 'Replace the current daily facts' : 'Create daily facts for ' + formatDate(date()) }}</h4>
            <p class="section-help">Distances accept precise decimals. Recalculation refreshes Strava-supported measurements while retaining manual workout and power points.</p>
          </div>
        </div>
        <div class="manual-facts-grid">
          <label>Steps <input type="number" min="0" step="1" [value]="manualSteps()" (input)="manualSteps.set(numberInputValue($event))" /></label>
          <label>Run treadmill (km) <input type="number" min="0" step="any" [value]="manualRunIndoorKm()" (input)="manualRunIndoorKm.set(numberInputValue($event))" /></label>
          <label>Run outdoor (km) <input type="number" min="0" step="any" [value]="manualRunOutdoorKm()" (input)="manualRunOutdoorKm.set(numberInputValue($event))" /></label>
          <label>Run unspecified (km) <input type="number" min="0" step="any" [value]="manualRunUnspecifiedKm()" (input)="manualRunUnspecifiedKm.set(numberInputValue($event))" /></label>
          <label>Bike indoor (km) <input type="number" min="0" step="any" [value]="manualBikeIndoorKm()" (input)="manualBikeIndoorKm.set(numberInputValue($event))" /></label>
          <label>Bike outdoor (km) <input type="number" min="0" step="any" [value]="manualBikeOutdoorKm()" (input)="manualBikeOutdoorKm.set(numberInputValue($event))" /></label>
          <label>Bike unspecified (km) <input type="number" min="0" step="any" [value]="manualBikeUnspecifiedKm()" (input)="manualBikeUnspecifiedKm.set(numberInputValue($event))" /></label>
          <label>Swim (m) <input type="number" min="0" step="any" [value]="manualSwimM()" (input)="manualSwimM.set(numberInputValue($event))" /></label>
          <label>Workout points <input type="number" min="0" step="1" [value]="manualWorkoutPoints()" (input)="manualWorkoutPoints.set(numberInputValue($event))" /></label>
          <label>Power points <input type="number" min="0" step="1" [value]="manualPowerPoints()" (input)="manualPowerPoints.set(numberInputValue($event))" /></label>
        </div>
        @if (validationError()) { <p class="form-error" role="alert">{{ validationError() }}</p> }
        @if (saveError()) { <p class="form-error" role="alert">{{ saveError() }}</p> }
        <div class="manual-form-actions">
          <button type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save manual facts' }}</button>
          <button type="button" class="secondary-button" [disabled]="saving()" (click)="editing.set(false)">Cancel</button>
        </div>
      </form>
    }
  `,
  styles: [`
    :host { display: block; container-type: inline-size; }
    .manual-facts-form { margin: 22px 0 0; padding: 16px; border: 1px solid #d8c68f; border-radius: 12px; background: #fffaf0; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .section-heading h4 { margin: 3px 0 0; color: #172b4d; font-size: 17px; }
    .section-label { color: #667085; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .section-help { margin: 5px 0 0; color: #667085; font-size: 12px; line-height: 1.45; }
    .manual-facts-grid { display: grid; grid-template-columns: repeat(2, minmax(130px, 1fr)); gap: 10px; }
    .manual-facts-grid label { display: grid; gap: 5px; color: #475467; font-size: 11px; font-weight: 700; }
    .manual-facts-grid input { min-width: 0; padding: 8px; border: 1px solid #cbd6ed; border-radius: 7px; background: white; }
    .manual-form-actions { display: flex; gap: 8px; margin-top: 14px; }
    .form-error { color: #b54747; font-size: 12px; }
    .secondary-button { border: 1px solid #cbd6ed; background: white; color: #40558f; box-shadow: none; }
    @container (max-width: 360px) {
      .manual-facts-grid { grid-template-columns: 1fr; }
      .manual-form-actions { display: grid; grid-template-columns: 1fr; }
    }
  `],
})
export class ScoreBreakdownManualFactsComponent implements OnChanges {
  readonly active = input(false);
  readonly date = input<string | null>(null);
  readonly breakdown = input<DailyScoreBreakdown | null>(null);
  readonly saving = input(false);
  readonly saveError = input<string | null>(null);
  readonly editRequestId = input(0);
  readonly showWhenEmpty = input(false);
  readonly save = output<ManualDailyFactsInput>();

  readonly editing = signal(false);
  readonly validationError = signal<string | null>(null);
  readonly manualSteps = signal(0);
  readonly manualRunIndoorKm = signal(0);
  readonly manualRunOutdoorKm = signal(0);
  readonly manualRunUnspecifiedKm = signal(0);
  readonly manualBikeIndoorKm = signal(0);
  readonly manualBikeOutdoorKm = signal(0);
  readonly manualBikeUnspecifiedKm = signal(0);
  readonly manualSwimM = signal(0);
  readonly manualWorkoutPoints = signal(0);
  readonly manualPowerPoints = signal(0);
  readonly formatDate = formatDate;

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

  startManualEdit(current: DailyScoreBreakdown | null): void {
    const facts = current?.facts;
    const runIndoorM = facts?.runIndoorM ?? 0;
    const runOutdoorM = facts?.runOutdoorM ?? 0;
    const bikeIndoorM = facts?.bikeIndoorM ?? 0;
    const bikeOutdoorM = facts?.bikeOutdoorM ?? 0;
    this.manualSteps.set(facts?.steps ?? 0);
    this.manualRunIndoorKm.set(runIndoorM / 1000);
    this.manualRunOutdoorKm.set(runOutdoorM / 1000);
    this.manualRunUnspecifiedKm.set(this.remainderDistanceKm(facts?.runM, runIndoorM, runOutdoorM, facts?.runUnspecifiedM));
    this.manualBikeIndoorKm.set(bikeIndoorM / 1000);
    this.manualBikeOutdoorKm.set(bikeOutdoorM / 1000);
    this.manualBikeUnspecifiedKm.set(this.remainderDistanceKm(facts?.bikeM, bikeIndoorM, bikeOutdoorM, facts?.bikeUnspecifiedM));
    this.manualSwimM.set(facts?.swimM ?? 0);
    this.manualWorkoutPoints.set(facts?.workoutPoints ?? 0);
    this.manualPowerPoints.set(facts?.powerPoints ?? 0);
    this.validationError.set(null);
    this.editing.set(true);
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
      ['Power points', this.manualPowerPoints()],
    ];
    const invalidField = fields.find(([, value]) => !Number.isFinite(value) || value < 0);
    if (invalidField) {
      this.validationError.set(`${invalidField[0]} must be a non-negative number.`);
      return;
    }
    if (![this.manualSteps(), this.manualWorkoutPoints(), this.manualPowerPoints()].every(Number.isInteger)) {
      this.validationError.set('Steps, workout points, and power points must be whole numbers.');
      return;
    }
    this.validationError.set(null);
    this.save.emit({
      steps: this.manualSteps(),
      runIndoorM: this.kilometersToMeters(this.manualRunIndoorKm()),
      runOutdoorM: this.kilometersToMeters(this.manualRunOutdoorKm()),
      runUnspecifiedM: this.kilometersToMeters(this.manualRunUnspecifiedKm()),
      bikeIndoorM: this.kilometersToMeters(this.manualBikeIndoorKm()),
      bikeOutdoorM: this.kilometersToMeters(this.manualBikeOutdoorKm()),
      bikeUnspecifiedM: this.kilometersToMeters(this.manualBikeUnspecifiedKm()),
      swimM: this.manualSwimM(),
      workoutPoints: this.manualWorkoutPoints(),
      powerPoints: this.manualPowerPoints(),
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
