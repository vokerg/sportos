import { Component, inject, output } from '@angular/core';
import { SyncEverythingStore } from '../state/sync-everything.store';

@Component({
  selector: 'sportos-sync-everything-control',
  standalone: true,
  providers: [SyncEverythingStore],
  template: `
    <section aria-label="Update training data" [attr.aria-busy]="store.busy()">
      <button type="button" [disabled]="store.busy()" (click)="start()">{{ store.label() }}</button>
      <p aria-live="polite" [attr.role]="store.view().status === 'error' ? 'alert' : 'status'">{{ store.view().message }}</p>
      <small>Import Strava, sync Garmin, then recalculate scores. Repeat any time.</small>
      @if (store.view().status === 'paused' || store.view().status === 'running') {
        <small>Keep this screen open for the next step. If you leave, return and continue; queued work is saved.</small>
      }
    </section>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; }
    section { display: grid; gap: 8px; padding: 20px; border-radius: 18px; background: var(--accent-surface); }
    button { width: 100%; min-height: 60px; padding: 16px 24px; border: 0; border-radius: 14px;
      background: var(--primary); color: var(--on-primary); font: inherit; font-size: 19px; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: .65; cursor: wait; }
    button:focus-visible { outline: 3px solid var(--link); outline-offset: 3px; }
    p { margin: 0; overflow-wrap: anywhere; } small { color: var(--text-muted); }
  `],
})
export class SyncEverythingControlComponent {
  readonly updated = output<void>();
  readonly store = inject(SyncEverythingStore);
  async start(): Promise<void> { if (await this.store.start()) this.updated.emit(); }
}
