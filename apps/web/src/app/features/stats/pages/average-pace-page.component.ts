import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'sportos-average-pace-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="report-page" aria-labelledby="report-title">
      <a class="back-link" routerLink="/stats">← Stats</a>
      <header>
        <span class="page-kicker">Training reports</span>
        <h1 id="report-title">{{ sport() === 'run' ? 'Average Pace' : 'Average Speed' }}</h1>
        <p>{{ sport() === 'run' ? 'Running pace in min/km.' : 'Cycling speed in km/h.' }}</p>
      </header>

      <div class="card report-content">
        <label for="report-sport">Sport</label>
        <select id="report-sport" [value]="sport()" (change)="setSport($event)">
          <option value="run">Running</option>
          <option value="bike">Bike</option>
        </select>
        <div class="placeholder" role="status">
          <span class="page-kicker">Coming soon</span>
          <h2>{{ sport() === 'run' ? 'Your running pace report' : 'Your cycling speed report' }}</h2>
          <p>This report is coming soon. No averages are calculated yet.</p>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .report-page { max-width: 1100px; margin: 0 auto; }
    .back-link { display: inline-block; margin-bottom: 18px; color: var(--link); font-size: 13px; font-weight: 700; }
    header { margin: 6px 0 24px; }
    .page-kicker { color: var(--link); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }
    p { margin: 0; color: var(--text-muted); line-height: 1.5; }
    .report-content { display: grid; gap: 10px; }
    label { font-size: 13px; font-weight: 750; }
    select { width: 100%; max-width: 240px; }
    .placeholder { padding: 48px 12px; text-align: center; }
    h2 { margin: 8px 0; font-size: 22px; }
  `],
})
export class AveragePacePageComponent {
  readonly sport = signal<'run' | 'bike'>('run');

  setSport(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'run' || value === 'bike') this.sport.set(value);
  }
}
