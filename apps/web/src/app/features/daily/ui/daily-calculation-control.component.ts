import { Component, OnInit, output } from '@angular/core';
import { DailyCalculationStore } from '../state/daily-calculation.store';

@Component({
  selector: 'sportos-daily-calculation-control',
  standalone: true,
  providers: [DailyCalculationStore],
  template: `
    <div class="calculation-control" aria-label="Calculate daily scores">
      <button type="button" (click)="run()" [disabled]="disabled()">{{ actionLabel() }}</button>
      @if (store.error()) {
        <span role="alert">{{ store.error() }}</span>
      } @else if (store.job()?.status === 'failed') {
        <span role="alert">{{ store.message() }}</span>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-block; }
    .calculation-control { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    button { padding: 10px 14px; border-radius: 11px; white-space: nowrap; }
    span[role="alert"] { flex-basis: 100%; color: var(--text-muted); font-size: 12px; }
  `],
})
export class DailyCalculationControlComponent implements OnInit {
  readonly calculated = output<void>();

  constructor(readonly store: DailyCalculationStore) {}

  ngOnInit(): void {
    this.store.initialize(() => this.calculated.emit());
  }

  actionLabel(): string {
    if (this.store.loading()) return 'Checking calculations…';
    if (this.store.working()) return 'Starting calculation…';
    if (this.store.error()) return 'Check status';
    if (this.store.active()) return 'Calculating…';
    const status = this.store.job()?.status;
    if (status === 'failed' || status === 'cancelled') return 'Retry calculation';
    return 'Calculate all';
  }

  disabled(): boolean {
    return this.store.loading() || this.store.working() || (this.store.active() && !this.store.error());
  }

  run(): void {
    if (this.disabled()) return;
    if (this.store.error() || !this.store.state()) {
      this.store.load();
    } else if (this.store.job()?.status === 'failed' || this.store.job()?.status === 'cancelled') {
      this.store.retry();
    } else {
      this.store.start();
    }
  }
}
