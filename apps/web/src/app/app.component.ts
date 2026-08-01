import { Component } from '@angular/core';
import { DailyLogComponent } from './daily-log.component';
import { ExportPanelComponent } from './export-panel.component';
import { ImportPanelComponent } from './import-panel.component';
import { RulesStudioComponent } from './rules-studio.component';
import { RunLabComponent } from './run-lab.component';

@Component({
  selector: 'sportos-root',
  standalone: true,
  imports: [DailyLogComponent, ExportPanelComponent, ImportPanelComponent, RulesStudioComponent, RunLabComponent],
  template: `
    <a class="skip-link" href="#main-content">Skip to cockpit</a>
    <main class="shell" id="main-content">
      <header class="card cockpit-header">
        <div>
          <h1>SportOS</h1>
          <p>Canonical sports data, deterministic scores, source provenance, and audited local workflows.</p>
        </div>
        <nav aria-label="Cockpit sections">
          <a href="#daily-log">Daily Log</a>
          <a href="#run-lab">Run Lab</a>
          <a href="#rules-studio">Rules</a>
          <a href="#imports">Imports</a>
          <a href="#canonical-export">Export</a>
        </nav>
      </header>

      <div class="grid two">
        <section class="grid" aria-label="Training review">
          <div id="daily-log"><sportos-daily-log #dailyLog /></div>
          <div id="run-lab"><sportos-run-lab /></div>
          <div id="rules-studio"><sportos-rules-studio /></div>
        </section>
        <aside class="grid" aria-label="Data operations">
          <div id="imports"><sportos-import-panel (reconcileDate)="dailyLog.openBreakdownForDate($event)" /></div>
          <div id="canonical-export"><sportos-export-panel /></div>
          <section class="card">
            <h2>Local cockpit scope</h2>
            <p>Import supported workbooks, inspect canonical facts and provenance, explain deterministic scores, manage audited rule versions, review performance history, and export a stable canonical JSON bundle.</p>
          </section>
        </aside>
      </div>
    </main>
  `,
})
export class AppComponent {}
