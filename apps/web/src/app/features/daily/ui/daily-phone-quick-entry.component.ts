import { DecimalPipe } from '@angular/common';
import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { kilometersToMeters, metersToKilometers } from '../../../distance-units';
import { formatDate } from '../../../date-time';
import { isCalendarDate, localCalendarDate } from '../../../shared/util/analytics-query-state';
import type { ManualDailyFactsInput } from '../../../score-breakdown.models';
import type { DailyQuickEntryChange, DailyQuickEntryGridRow } from '../model/daily-quick-entry.models';

const FIELDS = [
  { key: 'steps', label: 'Steps (excluding runs)', unit: 'whole' },
  { key: 'runOutdoorM', label: 'Run outdoors (km)', unit: 'km' },
  { key: 'runIndoorM', label: 'Run treadmill (km)', unit: 'km' },
  { key: 'runUnspecifiedM', label: 'Run other (km)', unit: 'km' },
  { key: 'bikeOutdoorM', label: 'Bike outdoors (km)', unit: 'km' },
  { key: 'bikeIndoorM', label: 'Bike indoors (km)', unit: 'km' },
  { key: 'bikeUnspecifiedM', label: 'Bike other (km)', unit: 'km' },
  { key: 'swimM', label: 'Swim (m)', unit: 'metres' },
  { key: 'workoutPoints', label: 'Workout points', unit: 'whole' },
  { key: 'bonusPoints', label: 'Bonus points', unit: 'whole' },
] as const satisfies readonly { key: keyof ManualDailyFactsInput; label: string; unit: string }[];

@Component({
  selector: 'sportos-daily-phone-quick-entry',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  template: `
    <section aria-labelledby="phone-entry-heading">
      <h3 id="phone-entry-heading">Edit one day</h3>
      <label for="quick-entry-date">Date</label>
      <input id="quick-entry-date" type="date" [value]="date()" [min]="range().from" [max]="range().to"
        [disabled]="busy()" (input)="setDate($event)" />
      @if (validDate()) {
        @if (row(); as current) {
          <p class="score"><strong>{{ current.totalPoints | number:'1.0-2' }}</strong> points</p>
          @for (selected of [current.date]; track selected) {
            <form #form (submit)="submit($event, form, current)">
              <fieldset [disabled]="busy()">
                <legend>Manual facts for {{ formatDate(selected) }}</legend>
                <div class="facts">
                  @for (field of fields; track field.key) {
                    <label>{{ field.label }}
                      <input type="number" [name]="field.key" [value]="displayValue(current, field)"
                        min="0" [max]="field.unit === 'km' ? 10000 : 10000000"
                        [step]="field.unit === 'whole' ? '1' : 'any'"
                        [attr.inputmode]="field.unit === 'whole' ? 'numeric' : 'decimal'" required />
                    </label>
                  }
                </div>
                <p>Saving recalculates the complete day.</p>
                <div class="actions">
                  <button type="submit">Save facts</button>
                  <button type="button" class="secondary" (click)="reset(form, current); refreshFromStrava.emit(selected)">Refresh Strava</button>
                </div>
              </fieldset>
            </form>
          }
          @if (current.saving || current.refreshing) {
            <p role="status">{{ current.saving ? 'Saving facts…' : 'Refreshing from Strava…' }}</p>
          } @else if (current.error) {
            <p class="error" role="alert">{{ current.error }}</p>
          } @else if (current.scoreStatus === 'manual') {
            <p role="status">Saved manual facts</p>
          }
        } @else {
          <p>No editable facts in this range for {{ formatDate(date()) }}.</p>
          @if (rows()[0]; as latest) {
            <button type="button" class="secondary latest" (click)="date.set(latest.date)">Latest recorded day</button>
          }
          <a [routerLink]="['/daily', date()]" [queryParams]="{ edit: 'true' }">Open manual entry</a>
        }
      } @else {
        <p role="status">Choose a date within the applied range.</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; margin-top: 20px; }
    h3 { margin: 0 0 10px; }
    input { display: block; width: 100%; min-width: 0; min-height: 44px; font-size: 16px; padding: 8px; }
    #quick-entry-date { -webkit-appearance: none; appearance: none; margin-top: 5px; }
    .score { margin: 12px 0; color: var(--text-muted); }
    .score strong { color: var(--text); }
    fieldset { min-width: 0; margin: 0; padding: 10px; border: 1px solid var(--border); border-radius: 12px; }
    legend { padding-inline: 4px; font-weight: 700; font-size: 13px; }
    .facts, .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .facts label { grid-template-rows: 1fr auto; }
    p { font-size: 13px; }
    button, a { min-height: 44px; }
    .latest { margin-inline-end: 10px; }
    a { display: inline-flex; align-items: center; }
    .error { color: var(--danger); overflow-wrap: anywhere; }
  `],
})
export class DailyPhoneQuickEntryComponent {
  readonly rows = input.required<readonly DailyQuickEntryGridRow[]>();
  readonly range = input.required<{ from: string; to: string }>();
  readonly save = output<DailyQuickEntryChange>();
  readonly refreshFromStrava = output<string>();

  readonly fields = FIELDS;
  readonly formatDate = formatDate;
  readonly date = linkedSignal(() => this.range().to || localCalendarDate());
  readonly validDate = computed(() => {
    const date = this.date();
    const { from, to } = this.range();
    return isCalendarDate(date) && (!from || from <= date) && (!to || date <= to);
  });
  readonly row = computed(() => this.rows().find(row => row.date === this.date()));
  readonly busy = computed(() => !!(this.row()?.saving || this.row()?.refreshing));

  setDate(event: Event): void {
    this.date.set((event.target as HTMLInputElement).value);
  }

  displayValue(row: DailyQuickEntryGridRow, field: typeof FIELDS[number]): number {
    const value = row[field.key] ?? 0;
    return field.unit === 'km' ? metersToKilometers(value) : value;
  }

  submit(event: Event, form: HTMLFormElement, row: DailyQuickEntryGridRow): void {
    event.preventDefault();
    if (this.busy() || !form.reportValidity()) return;
    const values = new FormData(form);
    const number = (key: keyof ManualDailyFactsInput) => Number(values.get(key));
    const input: ManualDailyFactsInput = {
      steps: number('steps'),
      runOutdoorM: kilometersToMeters(number('runOutdoorM')),
      runIndoorM: kilometersToMeters(number('runIndoorM')),
      runUnspecifiedM: kilometersToMeters(number('runUnspecifiedM')),
      bikeOutdoorM: kilometersToMeters(number('bikeOutdoorM')),
      bikeIndoorM: kilometersToMeters(number('bikeIndoorM')),
      bikeUnspecifiedM: kilometersToMeters(number('bikeUnspecifiedM')),
      swimM: number('swimM'),
      workoutPoints: number('workoutPoints'),
      bonusPoints: number('bonusPoints'),
    };
    this.save.emit({ date: row.date, input, previous: row });
  }

  reset(form: HTMLFormElement, row: DailyQuickEntryGridRow): void {
    for (const field of this.fields) {
      const input = form.elements.namedItem(field.key) as HTMLInputElement;
      input.value = String(this.displayValue(row, field));
    }
  }
}
