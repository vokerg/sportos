import { Component, OnInit } from '@angular/core';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { DailyLogComponent } from './daily-log.component';
import { ExportPanelComponent } from './export-panel.component';
import { ImportPanelComponent } from './import-panel.component';
import { ProviderPanelComponent } from './provider-panel.component';
import { RulesStudioComponent } from './rules-studio.component';
import { RunLabComponent } from './run-lab.component';
import { WebAuthService } from './web-auth.service';

@Component({
  selector: 'sportos-root',
  standalone: true,
  imports: [AnalysisPanelComponent, DailyLogComponent, ExportPanelComponent, ImportPanelComponent, ProviderPanelComponent, RulesStudioComponent, RunLabComponent],
  template: `
    <a class="skip-link" href="#main-content">Skip to cockpit</a>
    <main class="shell" id="main-content">
      @if (auth.state() === 'loading') {
        <section class="card auth-card" aria-live="polite">
          <h1>SportOS</h1>
          <p>Checking your session…</p>
        </section>
      } @else if (auth.state() === 'anonymous') {
        <section class="card auth-card">
          <h1>SportOS</h1>
          <p>Sign in to access your private training data, provenance, rules, jobs, exports, and read-only analysis.</p>
          <button type="button" (click)="auth.signIn()">Sign in</button>
        </section>
      } @else if (auth.state() === 'error') {
        <section class="card auth-card" role="alert">
          <h1>SportOS</h1>
          <p>{{ auth.errorMessage() }}</p>
          <button type="button" (click)="auth.loadSession()">Retry</button>
        </section>
      } @else {
        <header class="card cockpit-header">
          <div>
            <h1>SportOS</h1>
            <p>Canonical sports data, deterministic scores, cited read-only analysis, source provenance, and audited workflows.</p>
            <p class="session-label">Signed in as <strong>{{ auth.session()?.account?.displayName }}</strong></p>
          </div>
          <div class="header-actions">
            <nav aria-label="Cockpit sections">
              <a href="#analysis">Analysis</a>
              <a href="#daily-log">Daily Log</a>
              <a href="#run-lab">Run Lab</a>
              <a href="#rules-studio">Rules</a>
              <a href="#providers">Providers</a>
              <a href="#imports">Imports</a>
              <a href="#canonical-export">Export</a>
            </nav>
            <button type="button" class="secondary" (click)="auth.signOut()">Sign out</button>
          </div>
        </header>

        <div class="grid two cockpit-layout">
          <section class="grid" aria-label="Training review">
            <div id="analysis"><sportos-analysis-panel /></div>
            <div id="daily-log"><sportos-daily-log #dailyLog /></div>
            <div id="run-lab"><sportos-run-lab /></div>
            <div id="rules-studio"><sportos-rules-studio /></div>
          </section>
          <aside class="grid" aria-label="Data operations">
            <div id="providers"><sportos-provider-panel /></div>
            <div id="imports"><sportos-import-panel (reconcileDate)="dailyLog.openBreakdownForDate($event)" /></div>
            <div id="canonical-export"><sportos-export-panel /></div>
            <section class="card">
              <h2>Private account scope</h2>
              <p>Provider connections, uploads, jobs, canonical facts, score ledgers, rule versions, analysis audit identifiers, performance history, and exports are isolated to the signed-in account.</p>
            </section>
          </aside>
        </div>
      }
    </main>
  `,
  styles: [`
    .auth-card { max-width: 560px; margin: 10vh auto 0; text-align: center; }
    .cockpit-layout { align-items: start; }
    .header-actions { display: grid; justify-items: end; gap: 12px; }
    .session-label { margin: 8px 0 0; color: #475467; font-size: 13px; }
    @media (max-width: 760px) { .header-actions { justify-items: start; } }
  `],
})
export class AppComponent implements OnInit {
  constructor(readonly auth: WebAuthService) {}

  ngOnInit(): void {
    this.auth.loadSession();
  }
}
