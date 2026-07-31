import { Component } from '@angular/core';
import { DailyLogComponent } from './daily-log.component';
import { ImportPanelComponent } from './import-panel.component';
import { RulesStudioComponent } from './rules-studio.component';
import { RunLabComponent } from './run-lab.component';

@Component({
  selector: 'sportos-root',
  standalone: true,
  imports: [DailyLogComponent, ImportPanelComponent, RulesStudioComponent, RunLabComponent],
  template: `
    <main class="shell">
      <header class="card" style="margin-bottom: 16px;">
        <h1>SportOS</h1>
        <p>Spreadsheet import → canonical database → deterministic scores → dashboards. AI comes later, after the facts are clean.</p>
      </header>

      <div class="grid two">
        <section class="grid">
          <div id="daily-log">
            <sportos-daily-log #dailyLog />
          </div>
          <sportos-run-lab />
          <sportos-rules-studio />
        </section>
        <aside class="grid">
          <sportos-import-panel (reconcileDate)="dailyLog.openBreakdownForDate($event)" />
          <section class="card">
            <h2>Milestone scope</h2>
            <p>The local cockpit now preserves source provenance, executes imports in durable jobs, explains deterministic scores, and supports audited rule-version changes with previewed recomputation.</p>
          </section>
        </aside>
      </div>
    </main>
  `,
})
export class AppComponent {}
