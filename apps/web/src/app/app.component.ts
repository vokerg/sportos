import { Component } from '@angular/core';
import { DailyLogComponent } from './daily-log.component';
import { ImportPanelComponent } from './import-panel.component';
import { RunLabComponent } from './run-lab.component';

@Component({
  selector: 'sportos-root',
  standalone: true,
  imports: [DailyLogComponent, ImportPanelComponent, RunLabComponent],
  template: `
    <main class="shell">
      <header class="card" style="margin-bottom: 16px;">
        <h1>SportOS</h1>
        <p>Spreadsheet import → canonical database → deterministic scores → dashboards. AI comes later, after the facts are clean.</p>
      </header>

      <div class="grid two">
        <section class="grid">
          <sportos-daily-log />
          <sportos-run-lab />
        </section>
        <aside class="grid">
          <sportos-import-panel />
          <section class="card">
            <h2>Milestone scope</h2>
            <p>This first slice intentionally focuses on importing your existing files, storing raw provenance, computing daily scores, and showing the first review tables.</p>
          </section>
        </aside>
      </div>
    </main>
  `,
})
export class AppComponent {}
